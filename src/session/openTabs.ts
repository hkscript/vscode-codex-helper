import { CODEX_CONVERSATION_VIEW_TYPE, parseConversationId } from '../codex/conversationUri';
import type { OpenTab, UriLike } from '../codex/types';

/**
 * Snapshot of `vscode.window.tabGroups`, narrowed to what the scan needs.
 * `input` stays `unknown` on purpose: it is `TabInputCustom` for custom editor
 * tabs and something else entirely for text/terminal tabs.
 */
export interface TabGroupsSnapshot {
  all: Array<{ tabs: Array<{ label: string; input: unknown }> }>;
}

export interface OpenTabScanOptions {
  viewType?: string;
  /** override for `input instanceof TabInputCustom` (the default duck-types it) */
  isCustomInput?: (input: unknown) => boolean;
}

export function scanCodexTabs(
  tabGroups: TabGroupsSnapshot,
  options: OpenTabScanOptions = {},
): OpenTab[] {
  const viewType = options.viewType ?? CODEX_CONVERSATION_VIEW_TYPE;
  const isCustomInput =
    options.isCustomInput ??
    ((input: unknown): boolean =>
      input !== null &&
      typeof input === 'object' &&
      typeof (input as { viewType?: unknown }).viewType === 'string' &&
      'uri' in input);

  const open: OpenTab[] = [];
  for (const group of tabGroups.all ?? []) {
    for (const tab of group.tabs ?? []) {
      if (!isCustomInput(tab.input)) continue;
      const input = tab.input as { viewType: string; uri: UriLike };
      if (input.viewType !== viewType) continue;
      // A panel that is not bound to a conversation yet yields `null` here; it
      // still belongs in the tree as an unnamed new session.
      open.push({ id: parseConversationId(input.uri), tabLabel: tab.label });
    }
  }
  return open;
}
