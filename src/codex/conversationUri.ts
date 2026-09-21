import type { UriApi, UriLike } from './types';

/**
 * Conversation URI contract, replicated from the Codex extension bundle
 * (`openai.chatgpt` → `out/extension.js`, `ph` / `oPe` / `pI()` / `dI()`).
 * Keeping it in one module is deliberate: Codex upgrades can change it.
 */
export const CODEX_URI_SCHEME = 'openai-codex';
export const CODEX_URI_AUTHORITY = 'route';
export const CODEX_CONVERSATION_VIEW_TYPE = 'chatgpt.conversationEditor';

export function conversationPath(conversationId: string): string {
  return `/local/${conversationId}`;
}

export function buildConversationUri(uriApi: UriApi, conversationId: string): UriLike {
  return uriApi.file(conversationPath(conversationId)).with({
    scheme: CODEX_URI_SCHEME,
    authority: CODEX_URI_AUTHORITY,
    query: '',
  });
}

export function parseConversationId(uri: UriLike | null | undefined): string | null {
  if (!uri) return null;
  if (uri.scheme !== CODEX_URI_SCHEME) return null;
  if (uri.authority !== CODEX_URI_AUTHORITY) return null;
  const path = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
  const segments = path.split('/');
  if (segments.length < 2) return null;
  if (segments[0] !== 'local' && segments[0] !== 'remote') return null;
  return segments[1] ? segments[1] : null;
}
