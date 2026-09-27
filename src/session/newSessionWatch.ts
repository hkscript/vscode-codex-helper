/**
 * 「新建会话要等第一条消息才进 `thread/list`」的等待逻辑。
 *
 * 为什么要等：`+` 建出来的会话在面板里发出第一条消息之前**不在** `thread/list` 里
 * （空会话不落列表），而那一刻没有任何事件会通知本插件——那个 webview 不是我们的。
 * 于是侧边栏里点了 `+` 却迟迟没有新行，直到用户手动点刷新。这里就是那段「盯到它出现为止」
 * 的轮询规则；计时、IO、刷新都由调用方注入，所以规则本身可以在单测里穷举。
 */

export interface NewSessionWatchDeps {
  /** 当前列表里的会话 id。**不要带搜索过滤**：用户开着过滤不代表这个会话没出现。 */
  listThreadIds(): Promise<Iterable<string>>;
  /** 此刻还开着的 Codex 标签的会话 id（标签关了就说明用户不打算聊了）。 */
  openTabIds(): Set<string>;
  /** 新会话真的出现在列表里了：刷新侧边栏。 */
  refresh(): void;
  now(): number;
  /** 定时器由调用方给：生产传真的 `setInterval`，单测传可手动触发的假钟。 */
  setInterval(fn: () => void, ms: number): { cancel(): void };
  pollMs?: number;
  maxWaitMs?: number;
}

export interface NewSessionWatch {
  /** 开始等这个会话进列表；已经在等的会话会被覆盖计时。 */
  watch(id: string): void;
  stop(): void;
}

export const DEFAULT_NEW_SESSION_POLL_MS = 3_000;
export const DEFAULT_NEW_SESSION_MAX_WAIT_MS = 10 * 60_000;

export function createNewSessionWatch(deps: NewSessionWatchDeps): NewSessionWatch {
  const pollMs = deps.pollMs ?? DEFAULT_NEW_SESSION_POLL_MS;
  const maxWaitMs = deps.maxWaitMs ?? DEFAULT_NEW_SESSION_MAX_WAIT_MS;
  /** 还没进列表的会话：id → 开始等的时刻。 */
  const pending = new Map<string, number>();
  let timer: { cancel(): void } | undefined;

  function stop(): void {
    timer?.cancel();
    timer = undefined;
    pending.clear();
  }

  async function check(): Promise<void> {
    const openIds = deps.openTabIds();
    const now = deps.now();
    for (const [id, startedAt] of pending) {
      if (!openIds.has(id) || now - startedAt > maxWaitMs) pending.delete(id);
    }
    if (pending.size === 0) {
      stop();
      return;
    }

    let listed: Iterable<string>;
    try {
      listed = await deps.listThreadIds();
    } catch {
      return; // 拉列表失败（app-server 忙/重启中）：下一拍再试
    }
    let appeared = false;
    for (const id of listed) if (pending.delete(id)) appeared = true;
    if (!appeared) return;
    deps.refresh();
    if (pending.size === 0) stop();
  }

  return {
    watch(id: string): void {
      pending.set(id, deps.now());
      timer ??= deps.setInterval(() => {
        void check();
      }, pollMs);
    },
    stop,
  };
}
