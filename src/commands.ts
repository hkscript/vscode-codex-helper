import * as vscode from 'vscode';
import {
  CODEX_CONVERSATION_VIEW_TYPE,
  buildConversationUri,
  buildNewPanelUri,
} from './codex/conversationUri';
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
 *
 * 与归档三件套一样用返回值报告「真的做成了」：只有 `true` 才允许调用方刷新列表。
 * 取消（Esc / 空名字）与失败都返回 `false` —— 新名字只在服务端，本地缓存里没有，
 * 假成功刷新只会让用户看到旧标题还没变。
 */
export function createRenameSessionCommand(
  deps: RenameSessionCommandDeps,
): (node: RenameSessionNode | undefined) => Promise<boolean> {
  return async function renameSession(node: RenameSessionNode | undefined): Promise<boolean> {
    const sessionId = node?.sessionId;
    if (!sessionId) return false;

    const answer = await deps.showInputBox({
      value: node.label,
      prompt: '输入新的会话名称（会写回 Codex）',
      placeHolder: node.label,
    });
    // 用户取消（Esc）时什么都不做，绝不发请求
    if (answer === undefined) return false;

    const name = answer.trim();
    // 空名字会毁掉会话标题，直接当作取消处理
    if (name.length === 0) return false;

    try {
      await deps.threadApi.setThreadName(sessionId, name);
      return true;
    } catch (error) {
      deps.showErrorMessage(`重命名会话失败：${reasonOf(error)}`);
      return false;
    }
  };
}

/**
 * 新建会话分两步，优先「直接建会话」：
 *
 *  1. **建出会话再开绑定标签（首选）**：`thread/start` + `thread/metadata/update {gitInfo}`
 *     + `thread/resume` 让 Codex 把 rollout 落盘，再用 `openai-codex://route/local/<id>`
 *     打开标签。标签从出生就带会话 id ⇒ Codex 打开标签时会写标题（先首条消息，随后
 *     用 `thread/list` 的名字覆盖），并且侧边栏点那一行会聚焦这个标签而不是再开一个。
 *     细节和实测证据见 `src/session/sessionCreator.ts`。
 *  2. **回退：空白面板**（`/extension/panel/new` 带一个本次调用独有的 nonce）。不是
 *     git 仓库（探测不到 gitInfo）或建会话失败时走这里，行为与以前完全一致。
 *
 * 空白面板这条老路的历史结论留在这里，免得以后重走：
 *
 *  1. 委派 `chatgpt.newCodexPanel`（Codex 的「New Codex Agent」）：它的 resource 是常量
 *     `openai-codex://route/extension/panel/new`，而 Codex 注册自定义编辑器时声明
 *     `supportsMultipleEditorsPerDocument: false` —— 同一 resource 的第二次打开只会把已有
 *     标签移过去，连点「+」表现为「没反应」（这就是当初加 nonce 的原因）。
 *  2. 先 `thread/start` 把会话建出来、再按会话 id 打开 `openai-codex://route/local/<id>`
 *     （这样标签从出生就与会话绑定）：`thread/start` 出来的会话在首条消息之前**没有 rollout
 *     文件**（返回的 path 只是预计路径），而面板 hydrate 走 `thread/resume`。实测（沙箱、
 *     另起一个 app-server 进程）直接报 `no rollout found for thread id <id>`，面板显示
 *     「Failed to resume chat」。
 *  3. 委派 `chatgpt.newChat`（Codex 侧边栏新建）：不产生标签页，新会话落在 Codex 侧边栏里
 *     —— 用户明确不要这个入口。
 *
 * 于是只剩这条路：path 逐字保持 `/extension/panel/new`（webview 的路由才匹配得上），只让
 * resource 因 query 而不同，从而每次点击都开出独立面板。
 *
 * **空白面板的已知后果**（上游的面板模型决定，改不掉，见 README「已知限制」）：面板的
 * 文档 resource 永远停在这条路由上（webview 在面板里新建会话只做内部路由跳转），因此没有
 * 任何扩展知道「这个面板在看哪个会话」——面板标题停在常量 `Codex`，侧边栏里那条会话点开
 * 会另开一个绑定标签。走回退路径时仍然是这个代价。
 *
 * 这里不刷新：`extension.ts` 已订阅 `onDidChangeTabs`，新标签出现会自动刷新树。
 * 失败只报错，绝不静默回退到别的入口。
 */
export interface NewSessionCommandDeps {
  executeCommand(command: string, ...args: unknown[]): unknown;
  showErrorMessage(message: string): unknown;
  uriApi: UriApi;
  createNonce(): string;
  /**
   * 直接建出一个「面板能打开」的会话并返回它的 id；探测不到 gitInfo 或任一步失败时
   * 返回 `null`（此时回退空白面板）。这个依赖是流程里唯一会失败的部分，失败不打扰用户。
   */
  createBoundSession(): Promise<string | null>;
}

export function createNewSessionCommand(deps: NewSessionCommandDeps): () => Promise<void> {
  return async function newSession(): Promise<void> {
    // 1) 先试「直接建会话 → 开绑定标签」：标签从出生就绑定会话，标题由 Codex 自己写
    let boundId: string | null = null;
    try {
      boundId = await deps.createBoundSession();
    } catch {
      // 建会话失败不该报错打断用户：能不能建出来是加分项，回退路径才是保底
      boundId = null;
    }
    if (boundId) {
      try {
        await deps.executeCommand(
          'vscode.openWith',
          buildConversationUri(deps.uriApi, boundId),
          CODEX_CONVERSATION_VIEW_TYPE,
          { preview: false },
        );
        return;
      } catch (error) {
        deps.showErrorMessage(`打开新建的会话失败：${reasonOf(error)}`);
        return;
      }
    }

    // 2) 回退：空白面板（每次一个独立的 resource，才能多开）
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
  /**
   * 预检：这个会话是否被**别的** codex app-server 进程持有（被持有就一定撞锁）。
   * 可选：平台不支持探测（macOS / Windows）或没有接线时不预检，直接发请求。
   */
  isLockHeld?(threadId: string): Promise<boolean>;
}

/**
 * 跨进程写者锁：`thread/archive` / `thread/unarchive` / `thread/delete` 都要求这个会话没有
 * 被别的 app-server 进程持有。Codex 面板/侧边栏打开过它（哪怕之后关掉了标签），锁仍在
 * Codex 那个 app-server 进程里；本插件是另一个进程，抢不到、也放不掉：
 *  - `thread/resume` 想接管 → 同样回 `already has an active writer`；
 *  - `thread/unsubscribe` 由非持有者发 → 只影响自己的订阅，锁照旧；
 *  - 关掉标签页也不会释放（持有者是 Codex 的 app-server，不是标签；实测关掉很久仍报错）。
 * Codex 自己能在面板里归档，是因为它的归档流程是同一个进程里「先 unsubscribe 再 archive」
 * （bundle: `prepareOwnedThreadForUnarchive`）。字符串匹配与 Codex 自己的判断一致（`p6t`）。
 */
export function isActiveWriterError(reason: string): boolean {
  return /already has an active writer|already has a live local writer/i.test(reason);
}

/** 撞上写者锁（预检命中，或请求被拒）时给用户的唯一说明——预检和兜底共用同一句。 */
export function writerLockMessage(actionLabel: string): string {
  return `无法${actionLabel}这个会话：它被 Codex 那侧的 app-server 持有（打开过它，或它正在跑），本插件没法从外面改它。改用 Codex 自己的入口，或者 Reload Window 让 Codex 的 app-server 退出之后再试。`;
}

export function createSessionActionCommand(
  deps: SessionActionDeps,
): (node: { sessionId?: string } | undefined) => Promise<boolean> {
  return async function runSessionAction(node): Promise<boolean> {
    const sessionId = node?.sessionId;
    if (!sessionId) return false;

    // 预检命中就别发了：这个请求只会被 Codex 那侧的写者锁拒掉
    if (deps.isLockHeld && (await deps.isLockHeld(sessionId))) {
      deps.showErrorMessage(writerLockMessage(deps.actionLabel));
      return false;
    }

    try {
      await deps.perform(sessionId);
      return true;
    } catch (error) {
      const reason = reasonOf(error);
      if (isActiveWriterError(reason)) {
        // 预检漏掉的（探测失败、或刚好在这一刻被加载）走同一句说明
        deps.showErrorMessage(writerLockMessage(deps.actionLabel));
        return false;
      }
      deps.showErrorMessage(`${deps.actionLabel}会话失败：${reason}`);
      return false;
    }
  };
}

export interface ThreadActionCommandDeps {
  threadApi: { archiveThread(threadId: string): Promise<void> };
  showErrorMessage(message: string): unknown;
  isLockHeld?(threadId: string): Promise<boolean>;
}

export function createArchiveSessionCommand(deps: ThreadActionCommandDeps) {
  return createSessionActionCommand({
    perform: (threadId) => deps.threadApi.archiveThread(threadId),
    showErrorMessage: deps.showErrorMessage,
    actionLabel: '归档',
    isLockHeld: deps.isLockHeld,
  });
}

export function createUnarchiveSessionCommand(deps: {
  threadApi: { unarchiveThread(threadId: string): Promise<void> };
  showErrorMessage(message: string): unknown;
  isLockHeld?(threadId: string): Promise<boolean>;
}) {
  return createSessionActionCommand({
    perform: (threadId) => deps.threadApi.unarchiveThread(threadId),
    showErrorMessage: deps.showErrorMessage,
    actionLabel: '取消归档',
    isLockHeld: deps.isLockHeld,
  });
}

export function createDeleteSessionCommand(deps: {
  threadApi: { deleteThread(threadId: string): Promise<void> };
  showErrorMessage(message: string): unknown;
  isLockHeld?(threadId: string): Promise<boolean>;
}) {
  return createSessionActionCommand({
    perform: (threadId) => deps.threadApi.deleteThread(threadId),
    showErrorMessage: deps.showErrorMessage,
    actionLabel: '删除',
    isLockHeld: deps.isLockHeld,
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
