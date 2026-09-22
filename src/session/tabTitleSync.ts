import type { Thread, UriLike } from '../codex/types';

/**
 * Codex 的默认标签标题（上游 bundle: `qke = "Codex"`）。标题只在 `resolveCustomEditor`
 * 那一刻写一次：先 `summary.preview`，随后（仅当 resource 带会话 id）用 `thread/list`
 * 的 `name?.trim() || preview` 覆盖。
 *
 * 所以一个标签停在 `Codex` 只有两种可能：它压根没绑定会话（空白面板，扫描阶段就被
 * 丢掉了），或者它绑定的会话在打开时还没有标题。后者就是我们能修的那种。
 */
export const CODEX_DEFAULT_TAB_TITLE = 'Codex';

/** 上游的截断长度（bundle: `Bke = 30`）。 */
export const TAB_TITLE_MAX_LENGTH = 30;

/** resource 身份：scheme/authority/path/query 全同才算同一个文档。 */
export function resourceKey(uri: UriLike): string {
  return `${uri.scheme}://${uri.authority}${uri.path}?${uri.query}`;
}

/**
 * Codex 会为这个会话写成的标签标题；`null` 表示会话还没有任何可用的标题
 * （既没有名字也没有首条消息），此时不该动标签。
 */
export function expectedTabTitle(thread: Thread | undefined): string | null {
  const label = thread?.name?.trim() || thread?.preview || '';
  if (!label) return null;
  return label.length > TAB_TITLE_MAX_LENGTH
    ? `${label.slice(0, TAB_TITLE_MAX_LENGTH)}…`
    : label;
}

export interface TitleSyncTab {
  id: string;
  tabLabel: string;
  uri: UriLike;
  handle?: unknown;
}

export interface TitleSyncInput {
  tabs: readonly TitleSyncTab[];
  threads: readonly Thread[];
  /** `null` = 运行状态不可知（没开运行状态跟踪）⇒ 一律不动。 */
  runningIds: ReadonlySet<string> | null;
  /** 当前激活标签的 resource 身份（不是 Codex 标签时传 `null`）。 */
  activeTabKey: string | null;
  /** 已经同步过的目标标题：`sessionId -> expectedTitle`，防止 open/close 抖动。 */
  synced: ReadonlyMap<string, string>;
}

export interface TitleSyncPlan {
  tab: TitleSyncTab;
  sessionId: string;
  expectedTitle: string;
}

/**
 * 找出「标题还是 Codex 默认值、但会话已经有标题」的标签，计划把它们关掉重开一次
 * ——重开是让 Codex 重新 resolve 的唯一手段（它每次 resolve 都会自己写标题）。
 *
 * 只碰 `Codex` 这个默认标题，不碰任何已有自定义标题的标签：会话改名导致的旧标签
 * 漂移不在本次范围内，避免为了同步去重载用户正在看的对话。
 */
export function planTabTitleSync(input: TitleSyncInput): TitleSyncPlan[] {
  const { tabs, runningIds, activeTabKey, synced } = input;
  if (runningIds === null) return [];
  const titlesById = new Map<string, string>();
  for (const thread of input.threads) {
    const expected = expectedTabTitle(thread);
    if (expected) titlesById.set(thread.id, expected);
  }

  const plan: TitleSyncPlan[] = [];
  for (const tab of tabs) {
    if (tab.tabLabel !== CODEX_DEFAULT_TAB_TITLE) continue;
    if (tab.handle === undefined) continue;
    const expected = titlesById.get(tab.id);
    if (!expected || expected === tab.tabLabel) continue;
    if (runningIds.has(tab.id)) continue;
    if (synced.get(tab.id) === expected) continue;
    if (activeTabKey !== null && activeTabKey === resourceKey(tab.uri)) continue;
    plan.push({ tab, sessionId: tab.id, expectedTitle: expected });
  }
  return plan;
}
