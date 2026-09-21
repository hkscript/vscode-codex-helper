import type { OpenTab, SessionGroup, SessionGroupId, SessionItem, Thread, UriLike } from '../codex/types';

/**
 * Merges the session sources into the tree's groups.
 *
 * Design decisions encoded here (design.md D33/D40/D45):
 *  - 粒度统一为「会话」：置顶 / 最近 / 历史 / 已归档，一个会话只出现一行；
 *  - 已归档优先：归档的会话从另外三组里拿掉，否则同一个会话又会两行；
 *  - 「最近」= 未置顶会话里 `updatedAt` 最大的 RECENT_LIMIT 个，其余进「历史」；
 *  - 标签（openTabs）不再产生行，只用来给对应会话行打「已打开」标记并带上该标签的
 *    resource —— 未绑定会话的面板标签在扫描阶段就被丢掉（openTabs.ts），因此这里
 *    不存在「只有标签、没有会话」的行；
 *  - 每个分组用同一个过滤谓词，保证「显示出来的都匹配过滤条件」。
 */

export const GROUP_LABELS: Record<SessionGroupId, string> = {
  pinned: '置顶',
  recent: '最近',
  history: '历史',
  archived: '已归档',
};

/** 「最近」组的容量：未置顶会话里按 `updatedAt` 取前 N 个。 */
export const RECENT_LIMIT = 10;

export interface FilterableSession {
  id: string;
  label: string;
  preview: string;
}

export interface BuildSessionGroupsInput {
  threads: Thread[];
  /** 已归档会话（来自 `thread/list { archived: true }`），与 `threads` 互斥。 */
  archivedThreads?: Thread[];
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
  const archivedThreads = input.archivedThreads ?? [];
  const openTabs = input.openTabs ?? [];
  const pinnedIds = input.pinnedIds ?? [];
  const filter = input.filter ?? null;

  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  const pinnedSet = new Set(pinnedIds);
  const runningSet = new Set(input.runningIds ?? []);
  // 会话 id → 该标签自己的 resource：已打开的行靠它聚焦已经开着的那个标签。
  const tabUriByThreadId = new Map<string, UriLike>();
  for (const tab of openTabs) tabUriByThreadId.set(tab.id, tab.uri);

  function toItem(id: string, thread: Thread | undefined, archived: boolean): SessionItem {
    return {
      id,
      label: sessionItemLabel(thread),
      preview: thread?.preview ?? '',
      cwd: thread?.cwd ?? null,
      updatedAt: thread?.updatedAt ?? null,
      pinned: pinnedSet.has(id),
      open: tabUriByThreadId.has(id),
      running: runningSet.has(id),
      archived,
      tabUri: tabUriByThreadId.get(id) ?? null,
    };
  }

  // 1. 已归档：优先级最高，先占住这些 id，另外三组不再收它们。
  const archived: SessionItem[] = [];
  const claimed = new Set<string>();
  for (const thread of archivedThreads) {
    if (claimed.has(thread.id)) continue;
    claimed.add(thread.id);
    archived.push(toItem(thread.id, thread, true));
  }

  // 2. 置顶（未归档）：服务端查不到的陈旧置顶仍然丢弃（D8）。
  const pinned: SessionItem[] = [];
  for (const id of pinnedIds) {
    if (claimed.has(id)) continue;
    const thread = threadsById.get(id);
    if (!thread) continue;
    claimed.add(id);
    pinned.push(toItem(id, thread, false));
  }

  // 3. 其余未归档会话：最近更新的 RECENT_LIMIT 个进「最近」，剩下的进「历史」。
  //    排序按 updatedAt 而不是依赖服务端返回顺序——否则分组结果会随上游排序变化。
  const rest = threads.filter((thread) => !claimed.has(thread.id) && !pinnedSet.has(thread.id));
  const recent = [...rest]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, RECENT_LIMIT)
    .map((thread) => toItem(thread.id, thread, false));
  const recentIds = new Set(recent.map((session) => session.id));
  const history = rest
    .filter((thread) => !recentIds.has(thread.id))
    .map((thread) => toItem(thread.id, thread, false));

  return (
    [
      { id: 'pinned' as const, label: GROUP_LABELS.pinned, sessions: pinned },
      { id: 'recent' as const, label: GROUP_LABELS.recent, sessions: recent },
      { id: 'history' as const, label: GROUP_LABELS.history, sessions: history },
      { id: 'archived' as const, label: GROUP_LABELS.archived, sessions: archived },
    ]
      // 所有分组都过同一个谓词，否则「搜索后仍显示不匹配项」会在某个分组里出现。
      .map((group) => ({
        ...group,
        sessions: group.sessions.filter((session) => matchesFilter(session, filter)),
      }))
      .filter((group) => group.sessions.length > 0)
  );
}
