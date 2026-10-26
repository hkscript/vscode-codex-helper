import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { ChildProcessLike } from '../codex/appServerClient';
import type { ThreadApi } from '../codex/threadApi';
import type { OpenTab } from '../codex/types';
import { createNewSessionCommand } from '../commands';
import type { Logger } from '../log';
import { createNewSessionWatch, type NewSessionWatch } from '../session/newSessionWatch';
import {
  LAST_USED_SCAN_LIMIT,
  resolveNewSessionReasoningEffort,
} from '../session/reasoningEffort';
import {
  PLACEHOLDER_GIT_INFO,
  createBoundSession,
  waitForChildExit,
  type ExitableChild,
  type GitInfo,
} from '../session/sessionCreator';
import type { AppServerLauncher } from './appServer';

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

export interface NewSessionWiringDeps {
  launchAppServer: AppServerLauncher;
  configuration(): vscode.WorkspaceConfiguration;
  logger: Logger;
  /** 建会话前的同步钩子；用于在 Codex 面板打开前确保「不重试」补丁已落盘。 */
  beforeCreate?(): void;
  /** 快速模式：在已加载的 Codex 侧边栏中新建，true 时不再创建编辑器标签。 */
  tryOpenInSidebar?(): Promise<boolean>;
  /** 共享 app-server 上的会话 API（学思考级别、盯新会话进列表用）。 */
  api(): Pick<ThreadApi, 'listThreads'>;
  workspaceCwd(): string | null;
  openTabs(): OpenTab[];
  /** 新会话出现在列表里了：重新拉一次列表。 */
  reload(): void;
}

export interface NewSessionWiring {
  /** 侧边栏 `+` 与命令共用。 */
  newSession(): Promise<void>;
  /** 停掉等新会话进列表的轮询；之后才建好的会话也不再起轮询。 */
  stop(): void;
}

export function wireNewSession(deps: NewSessionWiringDeps): NewSessionWiring {
  const { configuration, logger } = deps;

  /**
   * 起一个**一次性** app-server 子进程建会话，然后等它退出。
   *
   * 为什么不能复用共享的那个 app-server：`thread/resume` 会持有该会话的 writer 锁，
   * 只要持有者进程活着，Codex 面板（另一个进程）的 resume 就会被拒
   * `already has an active writer`（`thread/unsubscribe` 实测也放不掉）。所以落盘这件事
   * 必须由一个马上退出的进程来做，锁随进程消失。
   */
  async function createBoundSessionInOneShot(): Promise<string | null> {
    // 三件互不依赖的事在点击时同时起跑，各自只在用到的那一步才等：
    //  - 学「上次用过的思考级别」要读一次 thread/list，是整条流程里最慢的一步（本机实测
    //    250~400ms）。放到已经热着的共享 app-server 上、只读要看的那几条，resume 之后写级别时
    //    才等它；thread/list 只读、不碰 writer 锁。学不到（或设置成 off）就建一个没有级别的
    //    会话，失败都在 resolveNewSessionReasoningEffort 内部咽掉。
    //  - 探测 git：一次性进程握手完成后才等它。
    //  - 冷启动一次性 app-server（createBoundSession 里的 start()）。
    const reasoningEffort = resolveNewSessionReasoningEffort({
      setting: configuration().get<string>('newSessionReasoningEffort'),
      listThreads: async () =>
        (await deps.api().listThreads({ limit: LAST_USED_SCAN_LIMIT })).data,
      log: (message) => logger.info(`[codex app-server:new-session] ${message}`),
    });
    const gitInfo = gitInfoForWorkspace().then((info) => info ?? PLACEHOLDER_GIT_INFO);

    let spawned: ChildProcessLike | undefined;
    const oneShot = deps.launchAppServer({
      logTag: 'codex app-server:new-session',
      // 这个进程只负责 thread/start → metadata → resume，不需要任何插件能力。
      // 插件远程同步在 *.chatgpt.com / GitHub 不通时会让建会话冷启动多等十几秒。
      args: ['--disable', 'plugins'],
      // `thread/settings/update`（把思考级别写进新建的会话）要求声明这个能力
      experimentalApi: true,
      onSpawn: (child) => {
        spawned = child;
      },
    });

    try {
      // 级别写进新建的这个会话：面板打开时读到的就是它，不会每次都退回面板自己的兜底档
      return await createBoundSession(oneShot, {
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
        gitInfo,
        reasoningEffort,
      });
    } finally {
      // 打开标签之前必须等它真的退出：锁没放开时 Codex 面板的 resume 会被拒。
      // 先挂退出监听再 kill —— 反过来的话，进程可能在监听装上之前就退出，白等一个超时。
      const exited = waitForChildExit(spawned as ExitableChild | undefined);
      oneShot.dispose();
      await exited;
    }
  }

  /**
   * 新建出来的会话要等面板里发出第一条消息才进 `thread/list`（空会话不落列表），而那一刻
   * 没有任何事件会通知本插件。不盯的话，侧边栏里点了 `+` 也不会有新行，直到手动刷新。
   * 规则本身在 `newSessionWatch.ts` 里（纯逻辑 + 单测），这里只接真实的 IO 与定时器。
   */
  let watch: NewSessionWatch | undefined = createNewSessionWatch({
    // 不带过滤：用户可能正开着搜索，那不能当成「这个会话还没出现」的证据
    listThreadIds: async () =>
      (await deps.api().listThreads({ cwd: deps.workspaceCwd(), cursor: null })).data.map(
        (thread) => thread.id,
      ),
    openTabIds: () => new Set(deps.openTabs().map((tab) => tab.id)),
    refresh: deps.reload,
    now: () => Date.now(),
    setInterval: (fn, ms) => {
      const handle = setInterval(fn, ms);
      return { cancel: () => clearInterval(handle) };
    },
  });

  const newSession = createNewSessionCommand({
    executeCommand: (command: string, ...args: unknown[]) =>
      Promise.resolve(vscode.commands.executeCommand(command, ...args)),
    showErrorMessage: (message: string) => vscode.window.showErrorMessage(message),
    // nonce 让每次点击落到不同的 resource —— 同一 resource 在 Codex 那边只会聚焦已有标签
    uriApi: vscode.Uri,
    createNonce: () => randomUUID(),
    beforeCreate: deps.beforeCreate,
    tryOpenInSidebar: deps.tryOpenInSidebar,
    // 首选：直接建出一个能被面板打开的会话（标签从出生就绑定会话）；
    // 建出来之后盯到它进列表为止，否则侧边栏里要手动刷新才看得到这一行
    createBoundSession: async () => {
      const id = await createBoundSessionInOneShot();
      if (id) watch?.watch(id);
      return id;
    },
  });

  return {
    /**
     * 建会话要先起一个一次性 app-server（实测：冷启动握手约 0.1~0.3s，start → metadata →
     * resume 约 0.1s，退出约 0.05s），这段时间没有任何界面反馈就会像卡死：给一个进度通知，
     * 做完自动消失。
     */
    newSession: () =>
      Promise.resolve(
        vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: '正在创建 Codex 会话…' },
          () => Promise.resolve(newSession()),
        ),
      ),
    stop: () => {
      watch?.stop();
      watch = undefined;
    },
  };
}
