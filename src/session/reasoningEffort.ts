/**
 * 「新建会话用哪个思考级别」的判断。
 *
 * 级别来源是 `thread/list`（按 updated_at 倒序）里最近一个非空 `reasoningEffort` ——
 * 那就是用户最后一次真正用过的值。选出来的级别会交给 `createBoundSession`，由它在
 * `thread/resume` 之后用 `thread/settings/update` 写进**新建的这个会话**（不是全局配置）。
 *
 * 为什么不在 `thread/start` 的 `config` 里覆盖（本机 probe 实测，不是文档承诺）：
 * 那个覆盖只在那一个进程内生效，换个 app-server 进程 resume 同一个会话读回来还是 null。
 */

/** 设置 `codexHelper.newSessionReasoningEffort` 的两个特殊取值。 */
export const EFFORT_SETTING_REMEMBER = 'remember';
export const EFFORT_SETTING_OFF = 'off';

/**
 * 面板/服务端认的级别取值（bundle 原文：`none, minimal, low, medium, high, xhigh, max, ultra`）。
 * 这里只列面板选择器里真正会给用户选的几档；取值本身是非空字符串，服务端不认会自己拒绝。
 */
export const REASONING_EFFORT_LEVELS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

/** 学「上次级别」时最多回看多少个会话：越近的会话越可能代表现在的习惯。 */
export const LAST_USED_SCAN_LIMIT = 10;

/** 只需要「有没有级别」这一个字段，方便纯函数测试。 */
export interface EffortBearingThread {
  reasoningEffort?: string | null;
}

/**
 * 挑出上次用过的级别。
 *
 * `threads` 必须是**按更新时间倒序**的（`thread/list` 的 `sortKey: updated_at, sortDirection: desc`）：
 * 插件不自己再排一遍，免得和上游排序打架。只看最近 `limit` 个会话，遇到第一个非空级别就返回。
 */
export function lastUsedReasoningEffort(
  threads: ReadonlyArray<EffortBearingThread>,
  limit: number = LAST_USED_SCAN_LIMIT,
): string | null {
  for (const thread of threads.slice(0, Math.max(0, limit))) {
    const effort = typeof thread?.reasoningEffort === 'string' ? thread.reasoningEffort.trim() : '';
    if (effort.length > 0) return effort;
  }
  return null;
}

/**
 * 设置值 + 学到的级别 → 这次要写进新会话的级别；`null` = 什么都不写。
 *
 *  - `off`：完全不干预（连列表都不读，见下面的解析函数）；
 *  - `remember` / 未设置：跟随上次用过的级别，学不到就不带级别建会话；
 *  - 其它非空值：当成用户显式指定的级别，直接用它。
 */
export function effortToApply(
  setting: string | undefined | null,
  lastUsed: string | null,
): string | null {
  const value = typeof setting === 'string' ? setting.trim() : '';
  if (value === EFFORT_SETTING_OFF) return null;
  if (value.length === 0 || value === EFFORT_SETTING_REMEMBER) return lastUsed;
  return value;
}

export interface NewSessionEffortDeps {
  /** `codexHelper.newSessionReasoningEffort` 的原始值（未设置时传 undefined）。 */
  setting: string | undefined | null;
  /** 拉一份按更新时间倒序的会话列表（生产里就是 `thread/list`）。 */
  listThreads(): Promise<ReadonlyArray<EffortBearingThread>>;
  log?(message: string): void;
}

/**
 * 建会话前的那一步：读设置 → 学上次级别 → 给出「要写进新会话的级别」。
 *
 * **任何失败都必须咽掉**并返回 null：级别只是顺带的优化，它不能影响「新建会话」这条主流程。
 * 返回值直接交给 `createBoundSession` 的 `reasoningEffort`。
 */
export async function resolveNewSessionReasoningEffort(
  deps: NewSessionEffortDeps,
): Promise<string | null> {
  const setting = typeof deps.setting === 'string' ? deps.setting.trim() : '';
  if (setting === EFFORT_SETTING_OFF) return null;

  try {
    const lastUsed =
      setting.length === 0 || setting === EFFORT_SETTING_REMEMBER
        ? lastUsedReasoningEffort(await deps.listThreads())
        : null;
    const effort = effortToApply(setting, lastUsed);
    if (effort) deps.log?.(`新会话将沿用思考级别 ${effort}`);
    return effort;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    deps.log?.(`解析新会话思考级别失败（不影响新建会话）：${reason}`);
    return null;
  }
}
