import * as vscode from 'vscode';

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
 * 新建会话：**先把会话建出来**（`thread/start`），再按会话 id 打开它的标签。
 *
 * 为什么不用 Codex 的 new-panel 路由（`/extension/panel/new`，Codex 自己的
 * `chatgpt.newCodexPanel` 用的也是它）：那条路由开出来的面板，文档 resource 永远停在
 * `/extension/panel/new`——Codex 的 webview 在面板里新建会话只做**内部路由跳转**，不改
 * 标签的 resource，上游自己的 `trackTabIfNeeded` / `registerPendingConversation` 也只在
 * 已知 `conversationId` 时才登记。于是没有任何扩展知道「这个面板在看哪个会话」：侧边栏
 * 里那条会话没有「已打开」标记，点它只能按会话 id 再开一个标签（用户报告的重复标签），
 * 而那个面板的标题还停在 Codex 的默认值 `Codex`。
 *
 * 先建会话再打开，标签从出生就带 `openai-codex://route/local/<id>`：侧边栏认得出它、
 * 点条目即聚焦、标题与列表取的是同一份数据（会话名/预览）。代价是新会话的 cwd 等参数
 * 由这次 `thread/start` 决定（调用方传当前工作区目录），不再是面板自己那套推断。
 *
 * 这里不刷新：`extension.ts` 已订阅 `onDidChangeTabs`，新标签出现会自动刷新树。
 * 失败只报错，绝不静默回退到别的入口。
 */
export interface NewSessionCommandDeps {
  /** 建会话，返回 threadId（`thread/start`）。 */
  startThread(): Promise<string>;
  /** 打开该会话；失败时由实现方报错（`opener.openSession` 的语义）。 */
  openConversation(threadId: string): Promise<boolean>;
  /** 会话建好了却打不开时的清理（`thread/delete`），避免在磁盘上留孤儿。 */
  discardThread(threadId: string): Promise<void>;
  showErrorMessage(message: string): unknown;
}

export function createNewSessionCommand(deps: NewSessionCommandDeps): () => Promise<void> {
  return async function newSession(): Promise<void> {
    let threadId: string;
    try {
      threadId = await deps.startThread();
    } catch (error) {
      deps.showErrorMessage(`新建会话失败：${reasonOf(error)}`);
      return;
    }

    if (await deps.openConversation(threadId)) return;

    // 打开失败的原因已经由 opener 报过了。刚建出来的空会话不出现在 `thread/list` 里
    // （首条消息之前是 unmaterialized），留着只会在磁盘上堆孤儿，直接删掉；清理再失败
    // 也不再报错——用户已经看到了真正的原因。
    try {
      await deps.discardThread(threadId);
    } catch {
      // 忽略：清理是尽力而为
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
