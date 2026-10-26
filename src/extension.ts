import * as vscode from 'vscode';
import type { AppServerClient } from './codex/appServerClient';
import { DEFAULT_PAGE_SIZE, createThreadApi } from './codex/threadApi';
import { createSafeLogger, type Logger } from './log';
import { createPinStore } from './session/pinStore';
import type { RunningTracker } from './session/runningTracker';
import { createSessionSource } from './session/sessionSource';
import {
  createSessionWebviewProvider,
  sessionWebviewAssets,
  type SessionWebviewProvider,
} from './ui/sessionWebviewProvider';
import { createAppServerLauncher } from './wiring/appServer';
import { createEditorTabs } from './wiring/editorTabs';
import { wireNewSession, type NewSessionWiring } from './wiring/newSession';
import { wirePatchOnOpen } from './wiring/noRetryPatch';
import { createRolloutScanner, wireRunningTracker } from './wiring/runningIndicator';
import { createSessionActions, registerSessionCommands } from './wiring/sessionActions';

let appServer: AppServerClient | undefined;
let autoRefresh: ReturnType<typeof setInterval> | undefined;
let runningTracker: RunningTracker | undefined;
let runningTrackerSubscriptions: vscode.Disposable[] = [];
/** 标签变化会成串到达；合并到下一拍再重绘/重算，避免切一个标签刷新多次。 */
let tabRefreshTimer: ReturnType<typeof setTimeout> | undefined;
/** 等新建会话进列表的轮询；模块级是为了让 `deactivate()` 能回收（同 autoRefresh）。 */
let newSessionWiring: NewSessionWiring | undefined;

/** workspaceState 里记住上次勾选的目录（按 VS Code workspace 隔离）。 */
const CWD_FILTER_KEY = 'codexHelper.cwdFilter';
const TAB_REFRESH_DEBOUNCE_MS = 50;

function savedCwdFilter(state: vscode.Memento): string[] {
  const raw = state.get<unknown>(CWD_FILTER_KEY);
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

/**
 * 自定义 Webview 视图：内嵌搜索框、目录筛选和右侧相对时间都超出 TreeView 的能力，
 * 但会话动作仍全部走扩展宿主里的命令。`retainContextWhenHidden` 让切走再回来时
 * 搜索词、滚动位置和焦点都还在。
 */
function registerSessionView(
  provider: SessionWebviewProvider,
  logger: Logger,
): vscode.Disposable[] {
  const view = vscode.window.registerWebviewViewProvider('codexHelper.sessions', provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  logger.info('registered session webview provider');
  return [
    view,
    // 扩展卸载后迟到的拉取结果不再往 webview 里重绘
    { dispose: () => provider.dispose() },
  ];
}

function stopAutoRefresh(): void {
  if (autoRefresh) clearInterval(autoRefresh);
  autoRefresh = undefined;
}

function stopTabRefresh(): void {
  if (tabRefreshTimer) clearTimeout(tabRefreshTimer);
  tabRefreshTimer = undefined;
}

/**
 * 定时刷新（`autoRefreshSeconds`，默认关）：侧边栏不可见时只记一笔、重新可见再补拉；
 * 改设置即时生效，关掉之后不会一直刷到重载窗口为止。
 */
function wireAutoRefresh(
  configuration: () => vscode.WorkspaceConfiguration,
  view: Pick<SessionWebviewProvider, 'reloadWhenVisible'>,
): vscode.Disposable {
  const arm = (): void => {
    stopAutoRefresh();
    const seconds = configuration().get<number>('autoRefreshSeconds') ?? 0;
    if (seconds > 0) autoRefresh = setInterval(() => view.reloadWhenVisible(), seconds * 1000);
  };
  arm();
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('codexHelper.autoRefreshSeconds')) arm();
  });
}

export function activate(context: vscode.ExtensionContext): void {
  // 诊断日志统一进 Output 面板的「Codex Helper」通道（用户排查时能直接看到）
  const output = vscode.window.createOutputChannel('Codex Helper', { log: true });
  context.subscriptions.push(output);
  const logger = createSafeLogger(output);

  const configuration = () => vscode.workspace.getConfiguration('codexHelper');
  const launchAppServer = createAppServerLauncher({
    version: String(context.extension.packageJSON.version),
    logger,
  });

  /** Lazy: the 250 MB binary is only spawned when data is actually needed (D3). */
  function api() {
    appServer ??= launchAppServer({ logTag: 'codex app-server' });
    return createThreadApi(appServer, {
      pageSize: configuration().get<number>('pageSize') ?? DEFAULT_PAGE_SIZE,
    });
  }

  function workspaceCwd(): string | null {
    if (!configuration().get<boolean>('filterByWorkspaceCwd')) return null;
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  const pinStore = createPinStore(context.globalState);
  const tabs = createEditorTabs({ logger });
  let tracker: RunningTracker | undefined;
  const sessions = createSessionSource({
    api,
    workspaceCwd,
    // 喂最新的线程列表。tracker 只在运行集合真的变化时才回调（D23），
    // 所以这条 refresh → load → update → refresh 的回环一轮就收敛。
    onFetched: (threads) => tracker?.update(threads),
  });
  const initialCwdFilter = savedCwdFilter(context.workspaceState);
  sessions.setCwdFilter(initialCwdFilter);

  async function loadMore(archived: boolean): Promise<void> {
    if (await sessions.loadMore(archived)) provider.refresh();
  }

  const provider = createSessionWebviewProvider({
    assets: sessionWebviewAssets(context.extensionUri, (base, ...segments) =>
      vscode.Uri.joinPath(base, ...segments),
    ),
    initialCwdFilter,
    saveCwdFilter: async (next) => {
      await context.workspaceState.update(CWD_FILTER_KEY, next);
    },
    // 单目录筛选直接交给 thread/list；多目录仍由数据源本地过滤
    onCwdFilterChange: (next) => sessions.setCwdFilter(next),
    fetch: sessions.fetch,
    loadAll: sessions.loadAll,
    loadPreview: sessions.loadPreview,
    snapshot: () => ({
      ...sessions.pages(),
      openTabs: tabs.openTabs(),
      pinnedIds: pinStore.list(),
      runningIds: tracker?.snapshot() ?? null,
    }),
    loadMore,
    openSession: (request) => actions.openSession(request),
    newSession: () => newSessions.newSession(),
    renameSession: (sessionId, label) => actions.renameSession(sessionId, label),
    pinSession: (sessionId) => actions.pinSession(sessionId),
    unpinSession: (sessionId) => actions.unpinSession(sessionId),
    archiveSession: (sessionId) => actions.archiveSession(sessionId),
    unarchiveSession: (sessionId) => actions.unarchiveSession(sessionId),
    deleteSession: (sessionId) => actions.deleteSession(sessionId),
    logger,
  });

  const patchOnOpen = wirePatchOnOpen({
    enabled: () => configuration().get<boolean>('patchCodexNoRetry') ?? true,
    logger,
  });

  const newSessions = wireNewSession({
    launchAppServer,
    configuration,
    logger,
    beforeCreate: patchOnOpen,
    api,
    workspaceCwd,
    openTabs: tabs.openTabs,
    reload: () => void provider.reload(),
  });
  newSessionWiring = newSessions;

  const rolloutScanner = createRolloutScanner();
  function disarmRunningTracker(): void {
    for (const subscription of runningTrackerSubscriptions) subscription.dispose();
    runningTrackerSubscriptions = [];
    runningTracker?.dispose();
    runningTracker = undefined;
    tracker = undefined;
  }

  function armRunningTracker(): void {
    disarmRunningTracker();
    const subscriptions: vscode.Disposable[] = [];
    tracker = wireRunningTracker({
      configuration,
      scanner: rolloutScanner,
      listTurns: (threadId) => api().listTurns(threadId),
      view: provider,
      subscriptions,
    });
    runningTrackerSubscriptions = subscriptions;
    runningTracker = tracker;
    tracker?.update(sessions.pages().threads);
  }

  armRunningTracker();

  context.subscriptions.push(...registerSessionView(provider, logger));

  const actions = createSessionActions({
    api,
    scanHeldRollouts: () => rolloutScanner.fresh(),
    ownPid: () => appServer?.pid(),
    pinStore,
    tabs,
    beforeOpen: patchOnOpen,
    view: provider,
  });

  context.subscriptions.push(
    wireAutoRefresh(configuration, provider),
    ...registerSessionCommands({
      actions,
      newSession: newSessions.newSession,
      loadMore: () => loadMore(false),
      view: provider,
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      stopTabRefresh();
      tabRefreshTimer = setTimeout(() => {
        tabRefreshTimer = undefined;
        provider.refresh();
        // 标签变化可能让 Codex 新加载一个会话；用现有线程列表重扫一次归属，
        // 但不额外拉 thread/list（那会在切换标签时产生不必要的往返）。
        tracker?.refresh();
      }, TAB_REFRESH_DEBOUNCE_MS);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codexHelper.codexExecutable')) {
        const current = appServer;
        appServer = undefined;
        current?.dispose();
        logger.info('codexExecutable 已修改，共享 app-server 将在下次请求时重启');
      }
      if (
        event.affectsConfiguration('codexHelper.showRunningIndicator') ||
        event.affectsConfiguration('codexHelper.runningPollSeconds') ||
        event.affectsConfiguration('codexHelper.runningStaleSeconds')
      ) {
        armRunningTracker();
      }
      if (event.affectsConfiguration('codexHelper.filterByWorkspaceCwd')) {
        void provider.reload();
      }
    }),
    {
      dispose: () => {
        stopTabRefresh();
        disarmRunningTracker();
      },
    },
  );
}

/** The app-server child process must not outlive the extension host (D3). */
export function deactivate(): void {
  stopAutoRefresh();
  stopTabRefresh();
  // 等新会话进列表的轮询同样不能活过扩展宿主
  newSessionWiring?.stop();
  newSessionWiring = undefined;
  // inotify 句柄与轮询定时器不回收会比扩展活得更久。
  runningTracker?.dispose();
  runningTracker = undefined;
  for (const subscription of runningTrackerSubscriptions) subscription.dispose();
  runningTrackerSubscriptions = [];
  appServer?.dispose();
  appServer = undefined;
}
