import * as vscode from 'vscode';
import type { ThreadApi } from '../codex/threadApi';
import {
  createArchiveSessionCommand,
  createDeleteSessionCommand,
  createRenameSessionCommand,
  createUnarchiveSessionCommand,
  registerCommands,
} from '../commands';
import { createSessionOpener } from '../session/opener';
import type { PinStore } from '../session/pinStore';
import { createRowOpener } from '../session/rowOpener';
import { createWriterLockProbe } from '../session/writerLock';
import type { SessionOpenRequest, SessionWebviewProvider } from '../ui/sessionWebviewProvider';
import type { EditorTabs } from './editorTabs';

export interface SessionActionsDeps {
  api(): Pick<ThreadApi, 'setThreadName' | 'archiveThread' | 'unarchiveThread' | 'deleteThread'>;
  /**
   * 归档/取消归档/删除前的预检：这个会话是不是被 Codex 那侧的 app-server 持有
   * （那种情况下请求必被写者锁拒掉，见 commands.ts）。用的是运行状态判定那个扫描器，
   * 但总是现扫，不吃缓存（理由见 writerLock.ts）。
   */
  scanHeldRollouts(): Promise<Map<string, number> | null>;
  /** 本插件自己的 app-server pid（还没起时为 undefined）。 */
  ownPid(): number | undefined;
  pinStore: PinStore;
  tabs: EditorTabs;
  /** 打开标签前的同步钩子（「不重试」补丁）。 */
  beforeOpen(): void;
  /** 快速模式：在已加载的 Codex 侧边栏里打开历史会话。 */
  openInSidebar?(sessionId: string): Promise<boolean>;
  view: Pick<SessionWebviewProvider, 'reload' | 'refresh'>;
}

/** 会话级动作：侧边栏 webview 与命令面板/菜单共用这一套。 */
export interface SessionActions {
  /** 命令/菜单交来的节点（可能带着该行自己的标签 resource）。 */
  openRow(node: unknown): Promise<void>;
  /** webview 回传的打开请求。 */
  openSession(request: SessionOpenRequest): Promise<void>;
  renameSession(sessionId: string, label: string): Promise<void>;
  pinSession(sessionId: string): Promise<void>;
  unpinSession(sessionId: string): Promise<void>;
  archiveSession(sessionId: string): Promise<void>;
  unarchiveSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}

export function createSessionActions(deps: SessionActionsDeps): SessionActions {
  const { pinStore, tabs, view } = deps;
  const showErrorMessage = (message: string) => vscode.window.showErrorMessage(message);

  const opener = createSessionOpener({
    executeCommand: (command: string, ...args: unknown[]) =>
      Promise.resolve(vscode.commands.executeCommand(command, ...args)),
    showErrorMessage,
    uriApi: vscode.Uri,
    beforeOpen: deps.beforeOpen,
  });

  const isLockHeld = createWriterLockProbe({
    scanHeldRollouts: deps.scanHeldRollouts,
    ownPid: deps.ownPid,
  });

  // 会话级动作的唯一 API 入口：重命名 + 归档三件套。
  const threadActions = {
    setThreadName: (threadId: string, name: string) => deps.api().setThreadName(threadId, name),
    archiveThread: (threadId: string) => deps.api().archiveThread(threadId),
    unarchiveThread: (threadId: string) => deps.api().unarchiveThread(threadId),
    deleteThread: (threadId: string) => deps.api().deleteThread(threadId),
  };

  const renameCommand = createRenameSessionCommand({
    threadApi: threadActions,
    showInputBox: (options) => Promise.resolve(vscode.window.showInputBox(options)),
    showErrorMessage,
  });

  // 归档 / 取消归档 / 删除：三个命令都不弹确认框（用户明确要求），
  // 防误删靠「删除入口只出现在已归档分组」这道流程闸。
  const archiveCommand = createArchiveSessionCommand({
    threadApi: threadActions,
    showErrorMessage,
    isLockHeld,
  });
  const unarchiveCommand = createUnarchiveSessionCommand({
    threadApi: threadActions,
    showErrorMessage,
    isLockHeld,
  });
  const deleteCommand = createDeleteSessionCommand({
    threadApi: threadActions,
    showErrorMessage,
    isLockHeld,
  });

  /**
   * 打开一行的编排（design D48）：归档行**先**取消归档（走同一个 unarchive 命令，
   * 失败会报错并返回 false —— 但不阻止打开），再按该行自己的标签 resource 聚焦，
   * 或者按会话 id 打开。
   */
  const rowOpener = createRowOpener({
    unarchive: async (threadId: string) => {
      const unarchived = await unarchiveCommand({ sessionId: threadId });
      if (unarchived) await view.reload();
      return unarchived;
    },
    revealTab: (uri) => opener.revealTab(uri),
    openSession: async (id) =>
      (await deps.openInSidebar?.(id)) ? true : opener.openSession(id),
    // 点这一行顺带把「标题还停在 Codex」的标签重载一次（见 reloadUntitledTab）
    reloadUntitledTab: tabs.reloadUntitledTab,
  });

  return {
    async openRow(node) {
      await rowOpener(node);
    },

    async openSession(request) {
      // tabUri 不能从 webview 回传：postMessage 走结构化克隆，vscode.Uri 会变成普通对象，
      // openWith 只认真正的 Uri 实例。这里按会话 id 现查一次已打开标签的 resource。
      const tabUri = tabs.openTabs().find((tab) => tab.id === request.sessionId)?.uri ?? null;
      await rowOpener({ ...request, tabUri });
    },

    async renameSession(sessionId, label) {
      // 新名字只写回了 Codex（本地 `threads` 还是旧的），重新拉一次列表才会显示出来
      if (await renameCommand({ sessionId, label })) await view.reload();
    },

    async pinSession(sessionId) {
      await pinStore.pin(sessionId);
      view.refresh();
    },

    async unpinSession(sessionId) {
      await pinStore.unpin(sessionId);
      view.refresh();
    },

    async archiveSession(sessionId) {
      if (await archiveCommand({ sessionId })) await view.reload();
    },

    async unarchiveSession(sessionId) {
      if (await unarchiveCommand({ sessionId })) await view.reload();
    },

    async deleteSession(sessionId) {
      if (!(await deleteCommand({ sessionId }))) return;
      // 删除不可逆：清掉置顶状态（否则 globalState 里留着陈旧 id）
      await pinStore.unpin(sessionId);
      // 再关掉显示这个会话的标签：跨进程删除不会通知 Codex 那侧的 webview，
      // 留着标签会让它继续 read/resume 一个已删除的会话（design D46）。
      const doomed = tabs.tabsOfConversation(sessionId);
      if (doomed.length > 0) {
        await vscode.window.tabGroups.close(doomed as never);
      }
      await view.reload();
    },
  };
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

/** 命令参数是节点：取不出会话 id 就什么都不做。 */
function bySessionId(run: (sessionId: string, node: unknown) => Promise<void>) {
  return async (node: unknown): Promise<void> => {
    const sessionId = sessionIdOf(node);
    if (!sessionId) return;
    await run(sessionId, node);
  };
}

export interface SessionCommandDeps {
  actions: SessionActions;
  newSession(): Promise<void>;
  /** 给未归档会话追加下一页。 */
  loadMore(): Promise<void>;
  view: Pick<SessionWebviewProvider, 'reload' | 'setFilter' | 'clearFilters'>;
}

export function registerSessionCommands(deps: SessionCommandDeps): vscode.Disposable[] {
  const { actions, view } = deps;
  return registerCommands({
    refresh: () => void view.reload(),
    openSession: (node) => actions.openRow(node),
    archiveSession: bySessionId(actions.archiveSession),
    unarchiveSession: bySessionId(actions.unarchiveSession),
    deleteSession: bySessionId(actions.deleteSession),
    renameSession: bySessionId((sessionId, node) =>
      actions.renameSession(sessionId, labelOf(node)),
    ),
    newSession: deps.newSession,
    pinSession: bySessionId(actions.pinSession),
    unpinSession: bySessionId(actions.unpinSession),
    setFilter: async () => {
      const answer = await vscode.window.showInputBox({
        prompt: '按会话名或会话 id 过滤',
        value: '',
      });
      if (answer === undefined) return;
      view.setFilter(answer.trim());
    },
    clearFilter: () => {
      view.clearFilters();
    },
    loadMore: deps.loadMore,
  });
}
