/**
 * 「新建会话用哪个思考级别」的判断与同步。
 *
 * 为什么是「写配置」而不是「给新会话设级别」（本机 probe 实测，不是文档承诺）：
 *  - `thread/start` 的 `config.model_reasoning_effort` 只在那一个进程内生效：换一个
 *    app-server 进程 resume 同一个会话，读回来的 `reasoningEffort` 还是 null；
 *  - 会话上真正落盘的级别（`threads.reasoning_effort` / rollout 的
 *    `thread_settings_applied`）只有面板自己发起回合（`turn/start` 带 `effort`）时才会写。
 *
 * 所以能做到的是另一条路：把**上次用过的级别**写进 `~/.codex/config.toml` 的
 * `model_reasoning_effort`，让 Codex 自己新建草稿时读到它。级别来源是 `thread/list`
 * （按 updated_at 倒序）里最近一个非空 `reasoningEffort` —— 那就是用户最后一次选的值。
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
 * 设置值 + 学到的级别 → 这次要写进配置的级别；`null` = 什么都不写。
 *
 *  - `off`：完全不干预（连列表都不读，见下面的同步函数）；
 *  - `remember` / 未设置：跟随上次用过的级别，学不到就不写；
 *  - 其它非空值：当成用户显式指定的级别，直接用它。
 */
export function effortToWrite(
  setting: string | undefined | null,
  lastUsed: string | null,
): string | null {
  const value = typeof setting === 'string' ? setting.trim() : '';
  if (value === EFFORT_SETTING_OFF) return null;
  if (value.length === 0 || value === EFFORT_SETTING_REMEMBER) return lastUsed;
  return value;
}

export interface NewSessionEffortSyncDeps {
  /** `codexHelper.newSessionReasoningEffort` 的原始值（未设置时传 undefined）。 */
  setting: string | undefined | null;
  /** 拉一份按更新时间倒序的会话列表（生产里就是 `thread/list`）。 */
  listThreads(): Promise<ReadonlyArray<EffortBearingThread>>;
  /** 真正落盘的一步；返回 false = 配置里已经就是这个值，没动文件。 */
  writeEffort(effort: string): Promise<boolean>;
  log?(message: string): void;
}

/**
 * 建会话前的那一步：读设置 → 学上次级别 → 写配置。
 *
 * **任何失败都必须咽掉**并返回 null：写级别只是顺带的优化，它不能影响「新建会话」这条主流程。
 * 返回值是真正写进配置的级别（没写就是 null），调用方只拿来记日志。
 */
export async function syncNewSessionReasoningEffort(
  deps: NewSessionEffortSyncDeps,
): Promise<string | null> {
  const setting = typeof deps.setting === 'string' ? deps.setting.trim() : '';
  if (setting === EFFORT_SETTING_OFF) return null;

  try {
    const lastUsed =
      setting.length === 0 || setting === EFFORT_SETTING_REMEMBER
        ? lastUsedReasoningEffort(await deps.listThreads())
        : null;
    const effort = effortToWrite(setting, lastUsed);
    if (!effort) return null;
    const written = await deps.writeEffort(effort);
    if (written) deps.log?.(`已把新会话的思考级别同步为 ${effort}`);
    return written ? effort : null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    deps.log?.(`同步新会话思考级别失败（不影响新建会话）：${reason}`);
    return null;
  }
}
