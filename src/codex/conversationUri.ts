import type { UriApi, UriLike } from './types';

/**
 * Conversation URI contract, replicated from the Codex extension bundle
 * (`openai.chatgpt` → `out/extension.js`, `ph` / `oPe` / `pI()` / `dI()`).
 * Keeping it in one module is deliberate: Codex upgrades can change it.
 */
export const CODEX_URI_SCHEME = 'openai-codex';
export const CODEX_URI_AUTHORITY = 'route';
export const CODEX_CONVERSATION_VIEW_TYPE = 'chatgpt.conversationEditor';

/**
 * Codex's own `createNewPanel()` opens exactly this path (bundle: `pI()`), and
 * its custom editor provider is registered with
 * `supportsMultipleEditorsPerDocument: false` — so a constant resource can only
 * ever have one editor tab. We keep the path verbatim (the webview matches
 * routes on pathname) and carry the identity in the query instead.
 */
export const NEW_PANEL_PATH = '/extension/panel/new';
export const NEW_PANEL_QUERY_KEY = 'newPanel';

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

export function buildNewPanelUri(uriApi: UriApi, nonce: string): UriLike {
  return uriApi.file(NEW_PANEL_PATH).with({
    scheme: CODEX_URI_SCHEME,
    authority: CODEX_URI_AUTHORITY,
    query: `${NEW_PANEL_QUERY_KEY}=${nonce}`,
  });
}
