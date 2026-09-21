import { CODEX_CONVERSATION_VIEW_TYPE, buildConversationUri } from '../codex/conversationUri';
import type { UriApi } from '../codex/types';

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
  };
}
