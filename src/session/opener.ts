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
}

export interface SessionOpener {
  openSession(id: string): Promise<boolean>;
  revealTab(uri: UriLike): Promise<boolean>;
}

export function createSessionOpener(deps: SessionOpenerDeps): SessionOpener {
  return {
    async openSession(id: string): Promise<boolean> {
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
