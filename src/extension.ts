import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, readlinkSync, watch } from 'node:fs';
import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import * as vscode from 'vscode';
import {
  CLIENT_NAME,
  createAppServerClient,
  type AppServerClient,
  type ChildProcessLike,
} from './codex/appServerClient';
import { CODEX_EXTENSION_ID, resolveCodexBinary } from './codex/binary';
import { CODEX_CONVERSATION_VIEW_TYPE } from './codex/conversationUri';
import { createNoRetryPatcher, createPatchOnOpen } from './codex/noRetryPatch';
import { createThreadApi } from './codex/threadApi';
import type { SessionGroup, Thread, UriLike } from './codex/types';
import {
  createArchiveSessionCommand,
  createDeleteSessionCommand,
  createNewSessionCommand,
  createRenameSessionCommand,
  createUnarchiveSessionCommand,
  registerCommands,
} from './commands';
import { createSessionOpener } from './session/opener';
import { createRowOpener } from './session/rowOpener';
import { scanCodexTabs, selectTabsForConversation } from './session/openTabs';
import { createPinStore } from './session/pinStore';
import { createNewSessionWatch, type NewSessionWatch } from './session/newSessionWatch';
import { scanHeldRollouts } from './session/processScan';
import { createRunningTracker, type RunningTracker } from './session/runningTracker';
import { buildSessionGroups } from './session/sessionStore';
import {
  PLACEHOLDER_GIT_INFO,
  createBoundSession,
  waitForChildExit,
  type ExitableChild,
  type GitInfo,
} from './session/sessionCreator';
import { CODEX_DEFAULT_TAB_TITLE, resourceKey } from './session/tabTitleSync';
import { createWriterLockProbe } from './session/writerLock';
import { createSessionTreeProvider } from './ui/treeProvider';

let appServer: AppServerClient | undefined;
let autoRefresh: ReturnType<typeof setInterval> | undefined;
let runningTracker: RunningTracker | undefined;
/** 等新建会话进列表的轮询；模块级是为了让 `deactivate()` 能回收（同 autoRefresh）。 */
let newSessionWatch: NewSessionWatch | undefined;

/** `vscode.git` 的导出形状（只用到仓库 HEAD 与远端地址两处）。 */
interface GitRepositoryLike {
  state?: {
    HEAD?: { name?: string | null; commit?: string | null } | null;
    remotes?: Array<{ fetchUrl?: string | null; pushUrl?: string | null }>;
  };
}

interface GitApiLike {
  getRepository?(uri: unknown): GitRepositoryLike | undefined;
  repositories?: GitRepositoryLike[];
}

/** Menu contributions hand us the tree node; `TreeItem.command` hands us a payload. Accept both. */
function sessionIdOf(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const candidate = node as { sessionId?: string; session?: { id?: string } };
  return candidate.sessionId ?? candidate.session?.id;
}

function labelOf(node: unknown): string {
  const candidate = node as { label?: unknown; session?: { label?: string } };
  const label = candidate?.session?.label ?? candidate?.label;
  return typeof label === 'string' ? label : '';
}

export function activate(context: vscode.ExtensionContext): void {
  const pinStore = createPinStore(context.globalState);
  let filter: string | null = null;
  let threads: Thread[] = [];
  let cursor: string | null = null;

  const configuration = () => vscode.workspace.getConfiguration('codexHelper');

  function binaryPath(): string {
    return resolveCodexBinary({
      getConfiguration: (section: string) => vscode.workspace.getConfiguration(section),
      getExtension: (id: string) => {
        const extension = vscode.extensions.getExtension(id);
        return extension ? { extensionPath: extension.extensionPath } : undefined;
      },
    });
  }

  /** Lazy: the 250 MB binary is only spawned when data is actually needed (D3). */
  function client(): AppServerClient {
    if (!appServer) {
      appServer = createAppServerClient({
        binaryPath: binaryPath(),
        spawn: ((command: string, args: string[], options: object) =>
          spawn(command, args, options)) as never,
        // 版本唯一来源是 package.json：发版只改那一个文件
        clientInfo: {
          name: CLIENT_NAME,
          version: String(context.extension.packageJSON.version),
        },
        onStderrLine: (line: string) => console.log(`[codex app-server] ${line}`),
      });
    }
    return appServer;
  }

  /**
   * 工作区第一个 folder 的真实 git 信息；探测不到（不是 git 仓库 / 没有 git 扩展）时
   * 返回 `null` —— 调用方会退回 `PLACEHOLDER_GIT_INFO`，因为**建会话本身不能因为
   * "这个目录没有 git" 而失效**（用户要的正是"任何目录下新建的会话标签都能拿到标题"）。
   *
   * `thread/metadata/update` 要求至少一个字段，而它是唯一**非破坏性**的落盘触发器：
   * `thread/name/set` 也能让 resume 成功，但会把会话名固定住、顶掉 Codex 的自动标题。
   */
  async function gitInfoForWorkspace(): Promise<GitInfo | null> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return null;
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) return null;
    try {
      const exported = (await gitExtension.activate()) as { getAPI?(version: number): unknown };
      const api = exported?.getAPI?.(1) as GitApiLike | undefined;
      const repository = api?.getRepository?.(folder.uri) ?? api?.repositories?.[0];
      const head = repository?.state?.HEAD;
      const remote = repository?.state?.remotes?.[0];
      const info: GitInfo = {};
      if (head?.name) info.branch = head.name;
      if (head?.commit) info.sha = head.commit;
      const originUrl = remote?.fetchUrl ?? remote?.pushUrl;
      if (originUrl) info.originUrl = originUrl;
      return Object.keys(info).length > 0 ? info : null;
    } catch {
      return null;
    }
  }

  /**
   * 起一个**一次性** app-server 子进程建会话，然后等它退出。
   *
   * 为什么不能复用共享的那个 app-server：`thread/resume` 会持有该会话的 writer 锁，
   * 只要持有者进程活着，Codex 面板（另一个进程）的 resume 就会被拒
   * `already has an active writer`（`thread/unsubscribe` 实测也放不掉）。所以落盘这件事
   * 必须由一个马上退出的进程来做，锁随进程消失。
   */
  async function createBoundSessionInOneShot(): Promise<string | null> {
    const gitInfo = (await gitInfoForWorkspace()) ?? PLACEHOLDER_GIT_INFO;

    let spawned: ChildProcessLike | undefined;
    const oneShot = createAppServerClient({
      binaryPath: binaryPath(),
      spawn: ((command: string, args: string[], options: object) => {
        const child = spawn(command, args, options);
        spawned = child as never;
        return child as never;
      }) as never,
      clientInfo: {
        name: CLIENT_NAME,
        version: String(context.extension.packageJSON.version),
      },
      onStderrLine: (line: string) => console.log(`[codex app-server:new-session] ${line}`),
    });

    try {
      return await createBoundSession(oneShot, {
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
        gitInfo,
      });
    } finally {
      // 打开标签之前必须等它真的退出：锁没放开时 Codex 面板的 resume 会被拒。
      // 先挂退出监听再 kill —— 反过来的话，进程可能在监听装上之前就退出，白等一个超时。
      const exited = waitForChildExit(spawned as ExitableChild | undefined);
      oneShot.dispose();
      await exited;
    }
  }

  function api() {
    return createThreadApi(client(), {
      pageSize: configuration().get<number>('pageSize') ?? 50,
    });
  }

  function workspaceCwd(): string | null {
    if (!configuration().get<boolean>('filterByWorkspaceCwd')) return null;
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  function openTabs() {
    return scanCodexTabs(
      {
        all: vscode.window.tabGroups.all.map((group) => ({
          // 栏号与组内下标：重开之后要把标签原样放回去
          viewColumn: group.viewColumn,
          // 句柄一起带出去：重开一个标题过时的标签得先把它关掉，而关它只能靠它自己的句柄
          tabs: group.tabs.map((tab) => ({ label: tab.label, input: tab.input, handle: tab })),
        })),
      },
      { isCustomInput: (input: unknown) => input instanceof vscode.TabInputCustom },
    );
  }

  /** 删除会话后要关掉的标签（只关会话 id 完全匹配的那些），交给 tabGroups.close。 */
  function tabsOfConversation(conversationId: string) {
    return selectTabsForConversation(
      {
        all: vscode.window.tabGroups.all.map((group) => ({
          tabs: group.tabs.map((tab) => ({ label: tab.label, input: tab.input, handle: tab })),
        })),
      },
      conversationId,
      { isCustomInput: (input: unknown) => input instanceof vscode.TabInputCustom },
    );
  }

  let tracker: RunningTracker | undefined;

  /** 当前激活标签的 resource 身份；`putTabBack` 用它确认「当前激活的就是刚打开那个」。 */
  function activeTabResourceKey(): string | null {
    const input = vscode.window.tabGroups.activeTabGroup?.activeTab?.input as
      | { uri?: UriLike }
      | undefined;
    const uri = input && typeof input === 'object' ? input.uri : undefined;
    return uri && typeof uri.path === 'string' ? resourceKey(uri) : null;
  }

  /**
   * 把刚重开的标签放回组内的原来那一格。
   *
   * 公开 API 没有移动/排序标签的能力，只能用 VS Code 的内部命令 `moveActiveEditor`
   * （「Move Editor Left/Right」「Move Editor to Start/End」这些内置动作执行的就是它）。
   * 语义取自本机 1.96 的产物 `workbench.desktop.main.js`：`{to:'position', by:'tab', value}`
   * 的 value 是 **1 基**下标，越界会被夹到末尾。拿不到原始下标、或命令不存在时都不动作
   * ——最坏情况只是标签留在末尾。
   */
  async function putTabBack(tab: { uri: UriLike; index?: number }): Promise<void> {
    const index = tab.index;
    if (typeof index !== 'number' || index < 0) return;
    // moveActiveEditor 作用于**当前激活编辑器**：如果重开没有把它激活（某些版本上
    // preserveFocus 生效，或者用户手快切走了），这里动手就会挪错标签，所以先核对身份
    const activeKey = activeTabResourceKey();
    if (activeKey === null || activeKey !== resourceKey(tab.uri)) return;
    try {
      await vscode.commands.executeCommand('moveActiveEditor', {
        to: 'position',
        by: 'tab',
        value: index + 1,
      });
    } catch {
      // 内部命令不在（换编辑器/换版本）就只是位置不还原，别的都不受影响
    }
  }

  /**
   * 点击某一行时：如果那个标签的标题还停在 Codex 默认值，就关掉重开一次。
   *
   * 为什么只能关掉重开：Codex 只在 `resolveCustomEditor` 那一刻写标题，而 VS Code 没有
   * 原地重解析的办法——Codex 的自定义编辑器 `supportsMultipleEditorsPerDocument: false`
   * 对应内部的 `singlePerResource`，用同一个 resource 再 resolve 一次只会拿回**已经开着**
   * 的那个编辑器，等于什么都不做。所以「让标题变对」= 让那个标签重新出生一次。
   *
   * 之所以挂在点击上而不是后台自动跑：重开会重载面板（内容白一下、未发送的草稿会丢），
   * 只有用户主动点这一行时才值得付这个代价。
   *
   * 返回 `true` = 已经重载好了（重开后它就是激活标签，调用方不用再聚焦）；`false` =
   * 没什么可重载的、或者重载没做成 —— 两种情况调用方都会退到 `revealTab`，所以失败
   * 不会让这一行打不开。
   */
 async function reloadUntitledTab(uri: UriLike): Promise<boolean> {
    const key = resourceKey(uri);
    const tab = openTabs().find((candidate) => resourceKey(candidate.uri) === key);
    if (!tab || tab.tabLabel !== CODEX_DEFAULT_TAB_TITLE || tab.handle === undefined) return false;
    try {
      await vscode.window.tabGroups.close(tab.handle as never, true);
    } catch (error) {
      // 没关掉就别接着 openWith：那只会聚焦原来那个标签，白闪一下什么也没修好
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`[codex-helper] 重载会话标签前关闭失败：${reason}`);
      return false;
    }
    try {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        tab.uri,
        CODEX_CONVERSATION_VIEW_TYPE,
        {
          // 落回它原来那一栏：不给 viewColumn 时会开在当前激活的栏里，标签等于搬了家
          ...(typeof tab.viewColumn === 'number' ? { viewColumn: tab.viewColumn } : {}),
          preview: false,
        },
      );
      // 重开出来的标签落在末尾，把它挪回原来的那一格
      await putTabBack(tab);
      return true;
    } catch (error) {
      // 关掉了却没打开成功：返回 false 让调用方用 revealTab 兜底把它开回来
      const reason = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`重新加载会话标签失败：${reason}`);
      return false;
    }
  }

  async function load(): Promise<SessionGroup[]> {
    // 两批会话并行拉：未归档（置顶/最近/历史）与已归档（「已归档」分组 —— 它同时是
    // 删除入口与撤销归档的地方）。两次请求共用同一个 app-server 握手（start 是幂等的）。
    const [page, archivedPage] = await Promise.all([
      api().listThreads({
        searchTerm: filter,
        cwd: workspaceCwd(),
        cursor: null,
      }),
      api().listThreads({
        searchTerm: filter,
        cwd: workspaceCwd(),
        archived: true,
      }),
    ]);
    threads = page.data;
    cursor = page.nextCursor;
    // 喂最新的线程列表。tracker 只在运行集合真的变化时才回调（D23），
    // 所以这条 refresh → load → update → refresh 的回环一轮就收敛。
    tracker?.update(threads);
    const groups = buildSessionGroups({
      threads,
      archivedThreads: archivedPage.data,
      openTabs: openTabs(),
      pinnedIds: pinStore.list(),
      runningIds: tracker?.snapshot() ?? null,
      filter,
    });
    return groups;
  }

  const provider = createSessionTreeProvider({ load });

  /**
   * 新建出来的会话要等面板里发出第一条消息才进 `thread/list`（空会话不落列表），而那一刻
   * 没有任何事件会通知本插件。不盯的话，侧边栏里点了 `+` 也不会有新行，直到手动刷新。
   * 规则本身在 `newSessionWatch.ts` 里（纯逻辑 + 单测），这里只接真实的 IO 与定时器。
   */
  newSessionWatch = createNewSessionWatch({
    // 不带 searchTerm：用户可能正开着过滤，那不能当成「这个会话还没出现」的证据
    listThreadIds: async () =>
      (await api().listThreads({ cwd: workspaceCwd(), cursor: null })).data.map(
        (thread) => thread.id,
      ),
    openTabIds: () => new Set(openTabs().map((tab) => tab.id)),
    refresh: () => provider.refresh(),
    now: () => Date.now(),
    setInterval: (fn, ms) => {
      const handle = setInterval(fn, ms);
      return { cancel: () => clearInterval(handle) };
    },
  });

  if (configuration().get<boolean>('showRunningIndicator') ?? true) {
    tracker = createRunningTracker({
      // 归属探测只在 Linux 可用；其他平台返回 null 走时间阈值降级（D16）。
      scanHeldRollouts: () =>
        process.platform === 'linux'
          ? scanHeldRollouts({ fs: { readdirSync, readlinkSync, readFileSync } })
          : null,
      listTurns: (threadId: string) => api().listTurns(threadId),
      watch: (path: string, onChange: () => void) => {
        const watcher = watch(path, onChange);
        return { close: () => watcher.close() };
      },
      onChange: () => provider.refresh(),
      pollSeconds: configuration().get<number>('runningPollSeconds') ?? 5,
      staleSeconds: configuration().get<number>('runningStaleSeconds') ?? 300,
    });
    runningTracker = tracker;
  }
  const view = vscode.window.createTreeView('codexHelper.sessions', {
    treeDataProvider: provider as unknown as vscode.TreeDataProvider<unknown>,
  });

  /**
   * 打开标签页时顺带确保 Codex 扩展的「不重试」补丁已打上（design D50）。
   * 它是 fire-and-forget 的后台动作：幂等、带备份、失败只记日志，绝不拖慢或阻断打开。
   */
  const patchOnOpen = createPatchOnOpen({
    enabled: () => configuration().get<boolean>('patchCodexNoRetry') ?? true,
    patcher: createNoRetryPatcher({
      extensionPath: () => vscode.extensions.getExtension(CODEX_EXTENSION_ID)?.extensionPath,
      readFile: (path) => readFile(path, 'utf8'),
      writeFile: (path, content) => writeFile(path, content, 'utf8'),
      copyFile: (from, to) => copyFile(from, to),
      exists: async (path) => {
        try {
          await access(path);
          return true;
        } catch {
          return false;
        }
      },
      compiles: (content) => {
        try {
          new Script(content);
          return true;
        } catch {
          return false;
        }
      },
      log: (message) => console.log(`[codex-helper] ${message}`),
    }),
    notify: (message) => void vscode.window.showInformationMessage(message),
    log: (message) => console.log(`[codex-helper] ${message}`),
  });

  const opener = createSessionOpener({
    executeCommand: (command: string, ...args: unknown[]) =>
      Promise.resolve(vscode.commands.executeCommand(command, ...args)),
    showErrorMessage: (message: string) => vscode.window.showErrorMessage(message),
    uriApi: vscode.Uri,
    beforeOpen: patchOnOpen,
  });

  const showErrorMessage = (message: string) => vscode.window.showErrorMessage(message);

  /**
   * 归档/取消归档/删除前的预检：这个会话是不是被 Codex 那侧的 app-server 持有
   * （那种情况下请求必被写者锁拒掉，见 commands.ts）。用的就是运行状态判定那份 /proc 扫描。
   */
  const isLockHeld = createWriterLockProbe({
    scanHeldRollouts: () =>
      process.platform === 'linux'
        ? scanHeldRollouts({ fs: { readdirSync, readlinkSync, readFileSync } })
        : null,
    ownPid: () => appServer?.pid(),
  });

  // 会话级动作的唯一 API 入口：重命名 + 归档三件套。
  const threadActions = {
    setThreadName: (threadId: string, name: string) => api().setThreadName(threadId, name),
    archiveThread: (threadId: string) => api().archiveThread(threadId),
    unarchiveThread: (threadId: string) => api().unarchiveThread(threadId),
    deleteThread: (threadId: string) => api().deleteThread(threadId),
  };

  const renameSession = createRenameSessionCommand({
    threadApi: threadActions,
    showInputBox: (options) => Promise.resolve(vscode.window.showInputBox(options)),
    showErrorMessage,
  });

  // 归档 / 取消归档 / 删除：三个命令都不弹确认框（用户明确要求），
  // 防误删靠「删除入口只出现在已归档分组」这道流程闸。
  const archiveSession = createArchiveSessionCommand({
    threadApi: threadActions,
    showErrorMessage,
    isLockHeld,
  });
  const unarchiveSession = createUnarchiveSessionCommand({
    threadApi: threadActions,
    showErrorMessage,
    isLockHeld,
  });
  const deleteSession = createDeleteSessionCommand({
    threadApi: threadActions,
    showErrorMessage,
    isLockHeld,
  });

  const newSession = createNewSessionCommand({
    executeCommand: (command: string, ...args: unknown[]) =>
      Promise.resolve(vscode.commands.executeCommand(command, ...args)),
    showErrorMessage,
    // nonce 让每次点击落到不同的 resource —— 同一 resource 在 Codex 那边只会聚焦已有标签
    uriApi: vscode.Uri,
    createNonce: () => randomUUID(),
    // 首选：直接建出一个能被面板打开的会话（标签从出生就绑定会话）；
    // 建出来之后盯到它进列表为止，否则侧边栏里要手动刷新才看得到这一行
    createBoundSession: async () => {
      const id = await createBoundSessionInOneShot();
      if (id) newSessionWatch?.watch(id);
      return id;
    },
  });

  /**
   * 打开一行的编排（design D48）：归档行**先**取消归档（走同一个 unarchive 命令，
   * 失败会报错并返回 false —— 但不阻止打开），再按该行自己的标签 resource 聚焦，
   * 或者按会话 id 打开。
   */
  const rowOpener = createRowOpener({
    unarchive: async (threadId: string) => {
      const unarchived = await unarchiveSession({ sessionId: threadId });
      if (unarchived) provider.refresh();
      return unarchived;
    },
    revealTab: (uri) => opener.revealTab(uri),
    openSession: (id) => opener.openSession(id),
    // 点这一行顺带把「标题还停在 Codex」的标签重载一次（见 reloadUntitledTab）
    reloadUntitledTab,
  });

  context.subscriptions.push(
    view,
    ...registerCommands({
      refresh: () => provider.refresh(),
      openSession: async (node) => {
        await rowOpener(node);
      },
      archiveSession: async (node) => {
        const id = sessionIdOf(node);
        if (!id) return;
        if (await archiveSession({ sessionId: id })) provider.refresh();
      },
      unarchiveSession: async (node) => {
        const id = sessionIdOf(node);
        if (!id) return;
        if (await unarchiveSession({ sessionId: id })) provider.refresh();
      },
      deleteSession: async (node) => {
        const id = sessionIdOf(node);
        if (!id) return;
        if (!(await deleteSession({ sessionId: id }))) return;
        // 删除不可逆：清掉置顶状态（否则 globalState 里留着陈旧 id）
        await pinStore.unpin(id);
        // 再关掉显示这个会话的标签：跨进程删除不会通知 Codex 那侧的 webview，
        // 留着标签会让它继续 read/resume 一个已删除的会话（design D46）。
        const doomed = tabsOfConversation(id);
        if (doomed.length > 0) {
          await vscode.window.tabGroups.close(doomed as never);
        }
        provider.refresh();
      },
      renameSession: async (node) => {
        const sessionId = sessionIdOf(node);
        if (!sessionId) return;
        // 新名字只写回了 Codex（本地 `threads` 还是旧的），刷一次列表才会显示出来
        if (await renameSession({ sessionId, label: labelOf(node) })) provider.refresh();
      },
      // 建会话要先起一个一次性 app-server（实测约 1.2s，其中 metadata/update 占 0.8s），
      // 这段时间没有任何界面反馈就会像卡死：给一个进度通知，做完自动消失。
      newSession: () =>
        Promise.resolve(
          vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '正在创建 Codex 会话…' },
            () => Promise.resolve(newSession()),
          ),
        ),
      pinSession: async (node) => {
        const id = sessionIdOf(node);
        if (!id) return;
        await pinStore.pin(id);
        provider.refresh();
      },
      unpinSession: async (node) => {
        const id = sessionIdOf(node);
        if (!id) return;
        await pinStore.unpin(id);
        provider.refresh();
      },
      setFilter: async () => {
        const answer = await vscode.window.showInputBox({
          prompt: '按会话名或会话 id 过滤',
          value: filter ?? '',
        });
        if (answer === undefined) return;
        filter = answer.trim().length > 0 ? answer.trim() : null;
        provider.refresh();
      },
      clearFilter: () => {
        filter = null;
        provider.refresh();
      },
      loadMore: async () => {
        if (!cursor) return;
        const page = await api().listThreads({
          searchTerm: filter,
          cwd: workspaceCwd(),
          cursor,
        });
        threads = [...threads, ...page.data];
        cursor = page.nextCursor;
        provider.refresh();
      },
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      provider.refresh();
    }),
  );

  const seconds = configuration().get<number>('autoRefreshSeconds') ?? 0;
  if (seconds > 0) {
    autoRefresh = setInterval(() => provider.refresh(), seconds * 1000);
  }
}

/** The app-server child process must not outlive the extension host (D3). */
export function deactivate(): void {
  if (autoRefresh) clearInterval(autoRefresh);
  autoRefresh = undefined;
  // 等新会话进列表的轮询同样不能活过扩展宿主
  newSessionWatch?.stop();
  newSessionWatch = undefined;
  // inotify 句柄与轮询定时器不回收会比扩展活得更久。
  runningTracker?.dispose();
  runningTracker = undefined;
  appServer?.dispose();
  appServer = undefined;
}
