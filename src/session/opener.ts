import { CODEX_CONVERSATION_VIEW_TYPE, buildConversationUri } from '../codex/conversationUri';
import type { UriApi, UriLike } from '../codex/types';

/**
 * Opens a session by driving the Codex custom editor through its internal
 * conversation URI. Codex registers with
 * `supportsMultipleEditorsPerDocument: false`, so "focus an already open tab"
 * and "open a closed one" are the same call (design decision D4).
 *
 * On failure we do NOT fall back to `chatgpt.newCodexPanel`: silently opening an
 * empty session would look like success while losing the user's conversation.
 */

export interface SessionOpenerDeps {
  executeCommand(command: string, ...args: unknown[]): unknown;
  showErrorMessage(message: string): unknown;
  uriApi: UriApi;
  /**
   * 打开标签前的同步钩子（目前用来确保 Codex 扩展的「不重试」补丁已打上）。
   *
   * 契约：同步返回、不得抛异常 —— 打开动作的成败与它无关。这里再包一层
   * try/catch，是为了不让任何一个实现破坏这条契约。
   */
  beforeOpen?: () => void;
}

export interface SessionOpener {
  openSession(id: string): Promise<boolean>;
  revealTab(uri: UriLike): Promise<boolean>;
}

function fireBeforeOpen(deps: SessionOpenerDeps): void {
  try {
    deps.beforeOpen?.();
  } catch {
    // 钩子只是顺带动作：它出错就当它不存在，绝不影响打开标签
  }
}

export function createSessionOpener(deps: SessionOpenerDeps): SessionOpener {
  return {
    async openSession(id: string): Promise<boolean> {
      fireBeforeOpen(deps);
      try {
        await deps.executeCommand(
          'vscode.openWith',
          buildConversationUri(deps.uriApi, id),
          CODEX_CONVERSATION_VIEW_TYPE,
          { preview: false },
        );
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        deps.showErrorMessage(`无法打开 Codex 会话 ${id}：${reason}`);
        return false;
      }
    },

    /**
     * 聚焦一个已经打开的标签：用**该标签自己的 resource** 调 `vscode.openWith`。
     * Codex 声明了 `supportsMultipleEditorsPerDocument: false`，所以对同一 resource
     * 的再次打开就是把已有编辑器聚焦过来，而不是新建一个（D33/D35）。
     */
    async revealTab(uri: UriLike): Promise<boolean> {
      fireBeforeOpen(deps);
      try {
        await deps.executeCommand('vscode.openWith', uri, CODEX_CONVERSATION_VIEW_TYPE, {
          preview: false,
        });
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        deps.showErrorMessage(`无法打开 Codex 标签页：${reason}`);
        return false;
      }
    },
  };
}
