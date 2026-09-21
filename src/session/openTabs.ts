import { CODEX_CONVERSATION_VIEW_TYPE, parseConversationId } from '../codex/conversationUri';
import type { OpenTab, UriLike } from '../codex/types';

/**
 * Snapshot of `vscode.window.tabGroups`, narrowed to what the scan needs.
 * `input` stays `unknown` on purpose: it is `TabInputCustom` for custom editor
 * tabs and something else entirely for text/terminal tabs.
 */
export interface TabGroupsSnapshot {
  all: Array<{
    tabs: Array<{
      label: string;
      input: unknown;
      /**
       * 原始标签句柄（生产里就是 `vscode.Tab`）。`selectTabsForConversation`
       * 需要把它交给 `tabGroups.close()`；扫描本身不用它。
       */
      handle?: unknown;
    }>;
  }>;
}

export interface OpenTabScanOptions {
  viewType?: string;
  /** override for `input instanceof TabInputCustom` (the default duck-types it) */
  isCustomInput?: (input: unknown) => boolean;
}

/** `input` 是不是自定义编辑器输入（默认鸭子类型判断，测试里可覆盖）。 */
function defaultIsCustomInput(input: unknown): boolean {
  return (
    input !== null &&
    typeof input === 'object' &&
    typeof (input as { viewType?: unknown }).viewType === 'string' &&
    'uri' in input
  );
}

export function scanCodexTabs(
  tabGroups: TabGroupsSnapshot,
  options: OpenTabScanOptions = {},
): OpenTab[] {
  const viewType = options.viewType ?? CODEX_CONVERSATION_VIEW_TYPE;
  const isCustomInput = options.isCustomInput ?? defaultIsCustomInput;

  const open: OpenTab[] = [];
  for (const group of tabGroups.all ?? []) {
    for (const tab of group.tabs ?? []) {
      if (!isCustomInput(tab.input)) continue;
      const input = tab.input as { viewType: string; uri: UriLike };
      if (input.viewType !== viewType) continue;
      // A panel that is not bound to a conversation yet has no conversation
      // identity at all. The sidebar only lists sessions, so such a tab is
      // skipped: letting it through used to create a synthetic `open-tab:<n>`
      // row that opened a nonexistent conversation when clicked.
      const id = parseConversationId(input.uri);
      if (!id) continue;
      open.push({ id, tabLabel: tab.label, uri: input.uri });
    }
  }
  return open;
}

/**
 * 删除会话后要关掉哪些标签：只挑 `conversationId` 完全相同的那些（D46）。
 * 返回原始标签句柄，交给 `vscode.window.tabGroups.close()`。
 */
export function selectTabsForConversation(
  tabGroups: TabGroupsSnapshot,
  conversationId: string,
  options: OpenTabScanOptions = {},
): unknown[] {
  const viewType = options.viewType ?? CODEX_CONVERSATION_VIEW_TYPE;
  const isCustomInput = options.isCustomInput ?? defaultIsCustomInput;

  const selected: unknown[] = [];
  for (const group of tabGroups.all ?? []) {
    for (const tab of group.tabs ?? []) {
      if (!isCustomInput(tab.input)) continue;
      const input = tab.input as { viewType: string; uri: UriLike };
      if (input.viewType !== viewType) continue;
      if (parseConversationId(input.uri) !== conversationId) continue;
      if (tab.handle !== undefined) selected.push(tab.handle);
    }
  }
  return selected;
}
