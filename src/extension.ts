import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync, watch } from 'node:fs';
import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import * as vscode from 'vscode';
import { CLIENT_NAME, createAppServerClient, type AppServerClient } from './codex/appServerClient';
import { CODEX_EXTENSION_ID, resolveCodexBinary } from './codex/binary';
import { createNoRetryPatcher, createPatchOnOpen } from './codex/noRetryPatch';
import { createThreadApi } from './codex/threadApi';
import type { SessionGroup, Thread } from './codex/types';
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
import { scanHeldRollouts } from './session/processScan';
import { createRunningTracker, type RunningTracker } from './session/runningTracker';
import { buildSessionGroups } from './session/sessionStore';
import { createSessionTreeProvider } from './ui/treeProvider';

let appServer: AppServerClient | undefined;
let autoRefresh: ReturnType<typeof setInterval> | undefined;
let runningTracker: RunningTracker | undefined;

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

  /** Lazy: the 250 MB binary is only spawned when data is actually needed (D3). */
  function client(): AppServerClient {
    if (!appServer) {
      const binaryPath = resolveCodexBinary({
        getConfiguration: (section: string) => vscode.workspace.getConfiguration(section),
        getExtension: (id: string) => {
          const extension = vscode.extensions.getExtension(id);
          return extension ? { extensionPath: extension.extensionPath } : undefined;
        },
      });
      appServer = createAppServerClient({
        binaryPath,
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

  function api() {
    return createThreadApi(client(), {
      pageSize: configuration().get<number>('pageSize') ?? 50,
    });
  }

  function workspaceCwd(): string | null {
    if (!configuration().get<boolean>('filterByWorkspaceCwd')) return null;
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  /**
   * 新会话的工作目录：当前窗口第一个工作区目录。与 `workspaceCwd()`（那是「列表过滤」
   * 开关）不同，这里不看配置——新建会话总要落到某个目录里；没有工作区时不传，交给
   * app-server 用自己进程的 cwd。
   */
  function newSessionCwd(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  function openTabs() {
    return scanCodexTabs(
      {
        all: vscode.window.tabGroups.all.map((group) => ({
          tabs: group.tabs.map((tab) => ({ label: tab.label, input: tab.input })),
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
    return buildSessionGroups({
      threads,
      archivedThreads: archivedPage.data,
      openTabs: openTabs(),
      pinnedIds: pinStore.list(),
      runningIds: tracker?.snapshot() ?? null,
      filter,
    });
  }

  const provider = createSessionTreeProvider({ load });

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
  const archiveSession = createArchiveSessionCommand({ threadApi: threadActions, showErrorMessage });
  const unarchiveSession = createUnarchiveSessionCommand({ threadApi: threadActions, showErrorMessage });
  const deleteSession = createDeleteSessionCommand({ threadApi: threadActions, showErrorMessage });

  const newSession = createNewSessionCommand({
    // 先把会话建出来，再按会话 id 打开标签：这样标签从出生就与会话绑定（见 commands.ts）
    startThread: () => api().startThread({ cwd: newSessionCwd() }),
    openConversation: (threadId) => opener.openSession(threadId),
    discardThread: (threadId) => api().deleteThread(threadId),
    showErrorMessage,
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
      renameSession: (node) => {
        const sessionId = sessionIdOf(node);
        return sessionId ? renameSession({ sessionId, label: labelOf(node) }) : undefined;
      },
      newSession,
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
    vscode.window.tabGroups.onDidChangeTabs(() => provider.refresh()),
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
  // inotify 句柄与轮询定时器不回收会比扩展活得更久。
  runningTracker?.dispose();
  runningTracker = undefined;
  appServer?.dispose();
  appServer = undefined;
}
