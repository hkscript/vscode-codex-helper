/**
 * 归档 / 取消归档 / 删除前的预检：这个会话是不是被**别的** codex app-server 进程持有？
 *
 * 这三个动作都要求独占（见 commands.ts 的 `isActiveWriterError`）：锁在 Codex 那侧时，
 * 发出去也只会拿到 `already has an active writer`，所以点击时先看一眼 `/proc` 的 rollout
 * 归属（与运行状态判定共用同一个扫描器），被别的进程持有就直接如实说明，不发那个注定
 * 失败的请求。
 *
 * 两个边界都在这里钉死：
 *  - 平台不支持探测（macOS / Windows：`scanHeldRollouts` 返回 null）→ 不预检，照旧发请求，
 *    失败时还有命令层那条同样的说明兜底；
 *  - 探测自己失败（例如 /proc 读不到）→ 不猜，放行。
 * 另外「自己持有」不算冲突：那种情况下 archive 是同进程操作，不会撞锁。
 */

export interface WriterLockProbeDeps {
  /**
   * Linux：`rollout → 持有它的 codex 进程 pid`；其他平台 null。
   *
   * 必须是点击之后现扫的结果，不能吃扫描器的缓存：持有它的进程刚退出（比如终端里的
   * codex 刚关掉）就来归档时，一两秒前的结果会把已经释放的会话误判成「被持有」直接拒掉。
   * 预检只在点击时跑一次，扫描又不阻塞宿主，多扫一轮的代价可以忽略。
   */
  scanHeldRollouts(): Promise<Map<string, number> | null>;
  /** 本插件自己的 app-server pid（还没起或已退出时为 undefined）。 */
  ownPid(): number | undefined;
}

export function createWriterLockProbe(
  deps: WriterLockProbeDeps,
): (threadId: string) => Promise<boolean> {
  return async function isHeldByAnotherProcess(threadId: string): Promise<boolean> {
    let held: Map<string, number> | null;
    try {
      held = await deps.scanHeldRollouts();
    } catch {
      return false;
    }
    if (!held) return false;

    const holder = held.get(threadId);
    if (holder === undefined) return false;

    const own = deps.ownPid();
    // 自己的 pid 未知 ⇒ 持有者不可能是我们（我们连 app-server 都还没起）
    return own === undefined || holder !== own;
  };
}
