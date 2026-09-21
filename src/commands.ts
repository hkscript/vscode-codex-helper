import * as vscode from 'vscode';
import { CODEX_CONVERSATION_VIEW_TYPE, buildNewPanelUri } from './codex/conversationUri';
import type { UriApi } from './codex/types';

/**
 * Command layer. Everything here is a thin adapter: the interesting logic lives
 * in the injected modules, which is what keeps the commands unit-testable.
 */

export interface RenameSessionNode {
  sessionId?: string;
  label: string;
}

export interface RenameSessionCommandDeps {
  threadApi: { setThreadName(threadId: string, name: string): Promise<void> };
  showInputBox(options?: { value?: string; prompt?: string; placeHolder?: string }): Promise<string | undefined>;
  showErrorMessage(message: string): unknown;
}

export interface CommandHandlers {
  refresh(): void;
  openSession(node: { sessionId?: string } | undefined): Promise<void> | void;
  renameSession(node: RenameSessionNode | undefined): Promise<void> | void;
  newSession(): Promise<void> | void;
  archiveSession(node: { sessionId?: string } | undefined): Promise<void> | void;
  unarchiveSession(node: { sessionId?: string } | undefined): Promise<void> | void;
  deleteSession(node: { sessionId?: string } | undefined): Promise<void> | void;
  pinSession(node: { sessionId?: string } | undefined): Promise<void> | void;
  unpinSession(node: { sessionId?: string } | undefined): Promise<void> | void;
  setFilter(): Promise<void> | void;
  clearFilter(): Promise<void> | void;
  loadMore(): Promise<void> | void;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Rename writes back to Codex through `thread/name/set`, so the new name shows
 * up in the TUI and the Codex plugin as well — it is not a private alias (D6).
 */
export function createRenameSessionCommand(
  deps: RenameSessionCommandDeps,
): (node: RenameSessionNode | undefined) => Promise<void> {
  return async function renameSession(node: RenameSessionNode | undefined): Promise<void> {
    const sessionId = node?.sessionId;
    if (!sessionId) return;

    const answer = await deps.showInputBox({
      value: node.label,
      prompt: '输入新的会话名称（会写回 Codex）',
      placeHolder: node.label,
    });
    // 用户取消（Esc）时什么都不做，绝不发请求
    if (answer === undefined) return;

    const name = answer.trim();
    // 空名字会毁掉会话标题，直接当作取消处理
    if (name.length === 0) return;

    try {
      await deps.threadApi.setThreadName(sessionId, name);
    } catch (error) {
      deps.showErrorMessage(`重命名会话失败：${reasonOf(error)}`);
    }
  };
}

/**
 * 新建会话：本插件自己打开 Codex 的 new-panel 路由，并在 query 上带一个本次调用
 * 独有的 nonce（design D28/D29）。
 *
 * 不能再委派 `chatgpt.newCodexPanel`：它的 resource 是常量
 * `openai-codex://route/extension/panel/new`，而 Codex 注册自定义编辑器时声明
 * `supportsMultipleEditorsPerDocument: false`——同一 resource 的第二次打开只会把
 * 已有的标签移过去，于是连点「+」表现为「没反应」。path 保持逐字不变，webview
 * 的路由才照旧匹配；只让 resource 因 query 而不同。
 *
 * 这里也不刷新：`extension.ts` 已订阅 `onDidChangeTabs`，新标签出现会自动刷新树。
 * 失败只报错，绝不静默回退到别的入口。
 */
export interface NewSessionCommandDeps {
  executeCommand(command: string, ...args: unknown[]): unknown;
  showErrorMessage(message: string): unknown;
  uriApi: UriApi;
  createNonce(): string;
}

export function createNewSessionCommand(deps: NewSessionCommandDeps): () => Promise<void> {
  return async function newSession(): Promise<void> {
    try {
      await deps.executeCommand(
        'vscode.openWith',
        buildNewPanelUri(deps.uriApi, deps.createNonce()),
        CODEX_CONVERSATION_VIEW_TYPE,
        { preview: false },
      );
    } catch (error) {
      deps.showErrorMessage(`新建会话失败：${reasonOf(error)}`);
    }
  };
}

/**
 * 「归档 / 取消归档 / 删除」三个命令同构：只注入 `threadApi` 与 `showErrorMessage`，
 * **没有任何确认/输入依赖**——用户明确要求这三个动作不弹确认框，「命令层根本没有
 * 弹框入口」就是这条要求的实现保证（而不是靠约定）。
 *
 * 返回值告诉调用方「真的做成了」：只有 `true` 才允许后续清理（关闭标签、取消置顶、
 * 刷新列表）。失败只报错并把异常挡在命令层内（与 rename 同一条线）。
 */
export interface SessionActionDeps {
  perform(threadId: string): Promise<void>;
  showErrorMessage(message: string): unknown;
  /** 失败提示里的动作名（「归档」「取消归档」「删除」）。 */
  actionLabel: string;
}

export function createSessionActionCommand(
  deps: SessionActionDeps,
): (node: { sessionId?: string } | undefined) => Promise<boolean> {
  return async function runSessionAction(node): Promise<boolean> {
    const sessionId = node?.sessionId;
    if (!sessionId) return false;
    try {
      await deps.perform(sessionId);
      return true;
    } catch (error) {
      deps.showErrorMessage(`${deps.actionLabel}会话失败：${reasonOf(error)}`);
      return false;
    }
  };
}

export interface ThreadActionCommandDeps {
  threadApi: { archiveThread(threadId: string): Promise<void> };
  showErrorMessage(message: string): unknown;
}

export function createArchiveSessionCommand(deps: ThreadActionCommandDeps) {
  return createSessionActionCommand({
    perform: (threadId) => deps.threadApi.archiveThread(threadId),
    showErrorMessage: deps.showErrorMessage,
    actionLabel: '归档',
  });
}

export function createUnarchiveSessionCommand(deps: {
  threadApi: { unarchiveThread(threadId: string): Promise<void> };
  showErrorMessage(message: string): unknown;
}) {
  return createSessionActionCommand({
    perform: (threadId) => deps.threadApi.unarchiveThread(threadId),
    showErrorMessage: deps.showErrorMessage,
    actionLabel: '取消归档',
  });
}

export function createDeleteSessionCommand(deps: {
  threadApi: { deleteThread(threadId: string): Promise<void> };
  showErrorMessage(message: string): unknown;
}) {
  return createSessionActionCommand({
    perform: (threadId) => deps.threadApi.deleteThread(threadId),
    showErrorMessage: deps.showErrorMessage,
    actionLabel: '删除',
  });
}

export function registerCommands(handlers: CommandHandlers): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('codexHelper.refresh', () => handlers.refresh()),
    vscode.commands.registerCommand('codexHelper.openSession', (node: { sessionId?: string }) =>
      handlers.openSession(node),
    ),
    vscode.commands.registerCommand('codexHelper.newSession', () => handlers.newSession()),
    vscode.commands.registerCommand('codexHelper.archiveSession', (node: { sessionId?: string }) =>
      handlers.archiveSession(node),
    ),
    vscode.commands.registerCommand('codexHelper.unarchiveSession', (node: { sessionId?: string }) =>
      handlers.unarchiveSession(node),
    ),
    vscode.commands.registerCommand('codexHelper.deleteSession', (node: { sessionId?: string }) =>
      handlers.deleteSession(node),
    ),
    vscode.commands.registerCommand('codexHelper.renameSession', (node: RenameSessionNode) =>
      handlers.renameSession(node),
    ),
    vscode.commands.registerCommand('codexHelper.pinSession', (node: { sessionId?: string }) =>
      handlers.pinSession(node),
    ),
    vscode.commands.registerCommand('codexHelper.unpinSession', (node: { sessionId?: string }) =>
      handlers.unpinSession(node),
    ),
    vscode.commands.registerCommand('codexHelper.setFilter', () => handlers.setFilter()),
    vscode.commands.registerCommand('codexHelper.clearFilter', () => handlers.clearFilter()),
    vscode.commands.registerCommand('codexHelper.loadMore', () => handlers.loadMore()),
  ];
}
