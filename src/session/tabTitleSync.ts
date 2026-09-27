import type { UriLike } from '../codex/types';

/**
 * Codex 的默认标签标题（上游 bundle: `qke = "Codex"`）。标题只在 `resolveCustomEditor`
 * 那一刻写一次：先 `summary.preview`，随后（仅当 resource 带会话 id）用 `thread/list`
 * 的 `name?.trim() || preview` 覆盖。
 *
 * 所以一个标签停在 `Codex` 只有两种可能：它压根没绑定会话（空白面板，扫描阶段就被
 * 丢掉了），或者它绑定的会话在打开时还没有标题。后者就是我们能修的那种——修法是
 * 「关掉重开让它重新出生一次」，见 `extension.ts::reloadUntitledTab`。
 */
export const CODEX_DEFAULT_TAB_TITLE = 'Codex';

/** resource 身份：scheme/authority/path/query 全同才算同一个文档。 */
export function resourceKey(uri: UriLike): string {
  return `${uri.scheme}://${uri.authority}${uri.path}?${uri.query}`;
}
