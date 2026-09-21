import type { OpenTab, SessionGroup, SessionGroupId, SessionItem, Thread } from '../codex/types';

/**
 * Merges the three session sources into the tree's groups.
 *
 * Design decisions encoded here (design.md D7/D8/D19):
 *  - 已打开 and 置顶 may both contain the same session — pinning survives
 *    opening (D19). 历史 stays mutually exclusive with both;
 *  - a pinned id that exists neither in the thread list nor as an open tab is a
 *    stale pin and is dropped (no ghost rows);
 *  - every rendered group is filtered with the same predicate, so "everything
 *    shown matches the filter" holds for all three groups.
 */

export const GROUP_LABELS: Record<SessionGroupId, string> = {
  open: '已打开',
  pinned: '置顶',
  history: '历史',
};

export interface FilterableSession {
  id: string;
  label: string;
  preview: string;
}

export interface BuildSessionGroupsInput {
  threads: Thread[];
  openTabs: OpenTab[];
  pinnedIds: string[];
  runningIds?: Iterable<string> | null;
  filter?: string | null;
}

export function matchesFilter(
  session: FilterableSession,
  keyword?: string | null,
): boolean {
  const needle = (keyword ?? '').trim().toLowerCase();
  if (needle.length === 0) return true;
  return `${session.id} ${session.label} ${session.preview}`.toLowerCase().includes(needle);
}

export function sessionItemLabel(thread: Thread | undefined, fallbackLabel?: string | null): string {
  const name = thread?.name?.trim();
  if (name) return name;
  const preview = thread?.preview?.trim();
  if (preview) return preview;
  const fallback = fallbackLabel?.trim();
  if (fallback) return fallback;
  return thread?.id ?? '';
}

export function buildSessionGroups(input: BuildSessionGroupsInput): SessionGroup[] {
  const threads = input.threads ?? [];
  const openTabs = input.openTabs ?? [];
  const pinnedIds = input.pinnedIds ?? [];
  const filter = input.filter ?? null;

  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  const pinnedSet = new Set(pinnedIds);
  const runningSet = new Set(input.runningIds ?? []);
  // 只管「历史组要排除谁」。已打开与置顶可以同时命中同一个会话（D19）。
  const claimed = new Set<string>();

  function toItem(
    id: string,
    thread: Thread | undefined,
    tabLabel: string | null,
    open: boolean,
  ): SessionItem {
    return {
      id,
      label: sessionItemLabel(thread, tabLabel),
      preview: thread?.preview ?? '',
      cwd: thread?.cwd ?? null,
      updatedAt: thread?.updatedAt ?? null,
      pinned: pinnedSet.has(id),
      open,
      running: runningSet.has(id),
    };
  }

  // 1. 已打开：标签页顺序即显示顺序。未绑定会话的新建标签用合成 id 占位，
  //    好让同一分组内「一个 id 只出现一次」不会被两个同名新标签破坏。
  const open: SessionItem[] = [];
  const openIds = new Set<string>();
  openTabs.forEach((tab: OpenTab, index: number) => {
    const id = tab.id ?? `open-tab:${index}`;
    if (openIds.has(id)) return;
    openIds.add(id);
    claimed.add(id);
    open.push(toItem(id, tab.id ? threadsById.get(tab.id) : undefined, tab.tabLabel, true));
  });

  // 2. 置顶：不再因为「已打开」而跳过（D19）；服务端查不到的陈旧置顶仍然丢弃（D8）。
  const pinned: SessionItem[] = [];
  const pinnedSeen = new Set<string>();
  for (const id of pinnedIds) {
    if (pinnedSeen.has(id)) continue;
    const thread = threadsById.get(id);
    if (!thread) continue;
    pinnedSeen.add(id);
    claimed.add(id);
    // open 如实反映状态：同一会话的两行都该说出「它开着」。
    pinned.push(toItem(id, thread, null, openIds.has(id)));
  }

  // 3. 历史：既没打开也没置顶的全部。
  const history: SessionItem[] = [];
  for (const thread of threads) {
    if (claimed.has(thread.id)) continue;
    claimed.add(thread.id);
    history.push(toItem(thread.id, thread, null, false));
  }

  return (
    [
      { id: 'open' as const, label: GROUP_LABELS.open, sessions: open },
      { id: 'pinned' as const, label: GROUP_LABELS.pinned, sessions: pinned },
      { id: 'history' as const, label: GROUP_LABELS.history, sessions: history },
    ]
      // 所有分组都过同一个谓词。历史组虽然服务端已经过滤过一次，本地要再复核一遍，
      // 否则「搜索后仍显示不匹配项」就会在历史组出现（D7 + INV-002）。
      .map((group) => ({
        ...group,
        sessions: group.sessions.filter((session) => matchesFilter(session, filter)),
      }))
      .filter((group) => group.sessions.length > 0)
  );
}
