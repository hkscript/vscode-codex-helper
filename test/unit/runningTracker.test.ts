import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Thread, Turn } from '../../src/codex/types';
import { createRunningTracker, type WatcherHandle } from '../../src/session/runningTracker';
import { makeThread, makeTurn } from '../helpers/fakes';

const NOW_MS = 1_789_970_400_000;
const DEBOUNCE = 300;

const pathOf = (id: string) => `/sessions/rollout-2026-09-21T13-08-48-${id}.jsonl`;

function thread(id: string): Thread {
  return makeThread({ id, updatedAt: Math.floor(NOW_MS / 1000), path: pathOf(id) });
}

const runningTurn = (): Turn => makeTurn({ id: 'turn-1', status: 'interrupted', completedAt: null });
const doneTurn = (): Turn => makeTurn({ id: 'turn-1', status: 'completed', completedAt: 100 });

interface FakeWatcher {
  handle: WatcherHandle;
  fire(): void;
  closed: boolean;
}

function harness(options: {
  held?: () => Map<string, number> | null;
  /** 直接控制扫描（异步、可挂起、可失败）；给了它就不看 `held`。 */
  scan?: (options: { fresh: boolean }) => Promise<Map<string, number> | null>;
  turns?: (threadId: string) => Promise<Turn | undefined>;
  watchThrows?: boolean;
  pollSeconds?: number;
  maxWaitMs?: number;
}) {
  const watchers = new Map<string, FakeWatcher>();
  const notifications: Array<Set<string>> = [];
  const watchCalls: string[] = [];

  const tracker = createRunningTracker({
    scanHeldRollouts:
      options.scan ?? (async () => (options.held ? options.held() : new Map([['t1', 4242]]))),
    listTurns: options.turns ?? (async () => runningTurn()),
    watch(path: string, onChange: () => void): WatcherHandle {
      watchCalls.push(path);
      if (options.watchThrows) throw new Error('EMFILE: too many open files');
      const entry: FakeWatcher = {
        handle: {
          close() {
            entry.closed = true;
          },
        },
        fire: onChange,
        closed: false,
      };
      watchers.set(path, entry);
      return entry.handle;
    },
    onChange: (ids) => notifications.push(ids),
    now: () => NOW_MS,
    debounceMs: DEBOUNCE,
    maxWaitMs: options.maxWaitMs,
    pollSeconds: options.pollSeconds ?? 5,
    staleSeconds: 300,
  });

  return { tracker, watchers, notifications, watchCalls };
}

describe('runningTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recomputes_and_notifies_after_rollout_write', async () => {
    let turn: Turn = doneTurn();
    const { tracker, watchers, notifications } = harness({ turns: async () => turn });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(notifications).toHaveLength(0);
    expect(tracker.snapshot().has('t1')).toBe(false);

    // 首轮就该给候选会话挂上监听，否则后面的写入根本传不进来
    expect(watchers.has(pathOf('t1'))).toBe(true);

    // rollout 文件被写入 → watcher 触发 → 重算 → 集合变化 → 回调
    turn = runningTurn();
    watchers.get(pathOf('t1'))!.fire();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(notifications).toHaveLength(1);
    expect([...notifications[0]!]).toEqual(['t1']);
    expect(tracker.snapshot().has('t1')).toBe(true);

    tracker.dispose();
  });

  it('debounces_multiple_writes_into_one_notification', async () => {
    // 一次回合里 rollout 会被写很多行；每行都重算一次会把 app-server 打满
    let turn: Turn = doneTurn();
    const listTurns = vi.fn(async () => turn);
    const { tracker, watchers, notifications } = harness({ turns: listTurns });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(listTurns).toHaveBeenCalledTimes(1);

    const watcher = watchers.get(pathOf('t1'))!;
    turn = runningTurn();
    watcher.fire();
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
    watcher.fire();
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
    watcher.fire();
    // 去抖窗口一直被刷新，三次写入还没触发任何一次重算
    expect(listTurns).toHaveBeenCalledTimes(1);
    expect(notifications).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    // 三次写入合并成恰好一次重算与一次回调
    expect(listTurns).toHaveBeenCalledTimes(2);
    expect(notifications).toHaveLength(1);
    expect([...notifications[0]!]).toEqual(['t1']);

    tracker.dispose();
  });

  it('recomputes_when_rollout_writes_keep_debounce_pending', async () => {
    const maxWait = 1000;
    let turn: Turn = doneTurn();
    const listTurns = vi.fn(async () => turn);
    const { tracker, watchers, notifications } = harness({
      maxWaitMs: maxWait,
      turns: listTurns,
    });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(listTurns).toHaveBeenCalledTimes(1);

    // 每 100ms 一次 rollout 写入，持续重置 trailing debounce：
    // 没有最大等待时，这轮重算会被永久饿死。
    turn = runningTurn();
    const watcher = watchers.get(pathOf('t1'))!;
    watcher.fire();
    for (let elapsed = 100; elapsed < maxWait; elapsed += 100) {
      await vi.advanceTimersByTimeAsync(100);
      watcher.fire();
    }
    await vi.advanceTimersByTimeAsync(99);
    expect(listTurns).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(listTurns).toHaveBeenCalledTimes(2);
    expect(notifications).toHaveLength(1);
    expect([...notifications[0]!]).toEqual(['t1']);

    tracker.dispose();
  });

  it('refresh_recomputes_with_a_fresh_scan_without_update', async () => {
    const scans: boolean[] = [];
    const listTurns = vi.fn(async () => doneTurn());
    const { tracker } = harness({
      scan: async ({ fresh }) => {
        scans.push(fresh);
        return new Map([['t1', 4242]]);
      },
      turns: listTurns,
    });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(scans).toEqual([true]);
    expect(listTurns).toHaveBeenCalledTimes(1);

    // 标签变化后当前 threads 里已经有新会话；不需要再次 update，
    // refresh 也必须强制现扫一次，让刚加载的会话进入候选集。
    tracker.refresh();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(scans).toEqual([true, true]);
    expect(listTurns).toHaveBeenCalledTimes(2);

    tracker.dispose();
  });

  it('does_not_notify_when_running_set_unchanged', async () => {
    const { tracker, notifications } = harness({});

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(notifications).toHaveLength(1);
    expect([...notifications[0]!]).toEqual(['t1']);

    // 模拟 refresh → load → update 的回环：状态没变就不能再回调，
    // 否则 onChange → refresh → load → update 会无限自激（D23）
    for (let round = 0; round < 5; round += 1) {
      tracker.update([thread('t1')]);
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    }

    expect(notifications).toHaveLength(1);
    expect(tracker.snapshot().has('t1')).toBe(true);

    tracker.dispose();
  });

  it('falls_back_to_polling_when_watch_throws', async () => {
    let turn: Turn = doneTurn();
    const { tracker, watchers, notifications, watchCalls } = harness({
      watchThrows: true,
      turns: async () => turn,
      pollSeconds: 5,
    });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(watchCalls).toContain(pathOf('t1'));
    expect(watchers.size).toBe(0); // watch 建不起来
    expect(notifications).toHaveLength(0);

    // 没有 watcher 也必须能发现状态变化——轮询兜底把它捞回来
    turn = runningTurn();
    await vi.advanceTimersByTimeAsync(5000 + DEBOUNCE);

    expect(notifications).toHaveLength(1);
    expect([...notifications[0]!]).toEqual(['t1']);

    tracker.dispose();
  });

  it('releases_watchers_for_dropped_candidates', async () => {
    let held = new Map<string, number>([
      ['t1', 4242],
      ['t2', 4243],
    ]);
    const { tracker, watchers } = harness({ held: () => held });

    tracker.update([thread('t1'), thread('t2')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(watchers.size).toBe(2);

    // t2 的进程退出了 → 它不再是候选 → 它的 inotify 句柄必须被释放
    held = new Map([['t1', 4242]]);
    watchers.get(pathOf('t1'))!.fire();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(watchers.get(pathOf('t2'))!.closed).toBe(true);
    // 还在候选里的那个不能被误关，否则它的后续写入就再也收不到了
    expect(watchers.get(pathOf('t1'))!.closed).toBe(false);

    tracker.dispose();
  });

  it('dispose_releases_all_watchers_and_timers', async () => {
    const { tracker, watchers, notifications } = harness({});

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(watchers.size).toBe(1);
    expect(watchers.get(pathOf('t1'))!.closed).toBe(false);
    expect(notifications).toHaveLength(1);

    tracker.dispose();

    // 扩展卸载后仍留着 inotify 句柄 / 定时器，是 deactivate 漏回收的经典症状
    expect([...watchers.values()].every((entry) => entry.closed)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    // dispose 之后的事件不得再触发任何回调
    tracker.update([thread('t1')]);
    watchers.get(pathOf('t1'))!.fire();
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 10);
    expect(notifications).toHaveLength(1);
  });

  it('stale_recompute_results_are_discarded', async () => {
    const pending: Array<(turn: Turn) => void> = [];
    const { tracker, notifications } = harness({
      turns: () => new Promise<Turn>((resolve) => pending.push(resolve)),
    });

    // 第一轮重算发出查询后挂起
    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(pending).toHaveLength(1);

    // 期间又来一次事件，第二轮查询先返回「正在跑」
    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(pending).toHaveLength(2);
    pending[1]!(runningTurn());
    await vi.advanceTimersByTimeAsync(0);

    expect([...notifications.at(-1)!]).toEqual(['t1']);

    // 迟到的第一轮结果说「已结束」——它比当前状态旧，必须被丢弃（D25）
    pending[0]!(doneTurn());
    await vi.advanceTimersByTimeAsync(0);

    expect(notifications).toHaveLength(1);
    expect(tracker.snapshot().has('t1')).toBe(true);

    tracker.dispose();
  });

  it('throwing_turn_query_does_not_clear_other_sessions', async () => {
    // D24 的另一半：查询「抛错」（而不只是返回空）也不能带走别的会话。
    // schedule() 用 `void recompute()` 丢弃 promise，异常会变成 unhandled rejection，
    // 整轮重算静默失效——所以这条边界必须由测试钉住，而不是靠 catch 写得对。
    const { tracker, notifications } = harness({
      held: () => new Map([['t1', 4242], ['t2', 4243]]),
      turns: async (threadId) => {
        if (threadId === 't1') throw new Error('thread/turns/list failed');
        return runningTurn();
      },
    });

    tracker.update([thread('t1'), thread('t2')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    // t1 查询失败 ⇒ 判非运行；t2 照常运行；回调仍按运行集合发出
    expect(tracker.snapshot().has('t1')).toBe(false);
    expect(tracker.snapshot().has('t2')).toBe(true);
    expect(notifications).toHaveLength(1);
    expect([...notifications[0]!]).toEqual(['t2']);

    tracker.dispose();
  });
  it('update_requests_a_fresh_scan_while_rollout_writes_may_reuse_one', async () => {
    // 新列表可能带来刚起跑的会话，拿缓存里稍早的扫描会漏掉它；候选自己的写入只关心已知候选
    const scans: boolean[] = [];
    const { tracker, watchers } = harness({
      scan: async ({ fresh }) => {
        scans.push(fresh);
        return new Map([['t1', 4242]]);
      },
    });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(scans).toEqual([true]);

    watchers.get(pathOf('t1'))!.fire();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(scans).toEqual([true, false]);

    // 一次去抖窗口里只要有过 update，这一轮就得现扫
    watchers.get(pathOf('t1'))!.fire();
    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(scans).toEqual([true, false, true]);

    tracker.dispose();
  });

  it('scan_resolving_after_dispose_neither_watches_nor_notifies', async () => {
    let resolveScan: ((held: Map<string, number>) => void) | undefined;
    const { tracker, notifications, watchCalls } = harness({
      scan: () =>
        new Promise((resolve) => {
          resolveScan = resolve;
        }),
    });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(resolveScan).toBeDefined();

    tracker.dispose();
    resolveScan!(new Map([['t1', 4242]]));
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 10);

    // 迟到的扫描结果不能在 dispose 之后再挂 inotify 句柄、发回调
    expect(watchCalls).toHaveLength(0);
    expect(notifications).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stale_scan_results_are_discarded', async () => {
    const pending: Array<(held: Map<string, number>) => void> = [];
    const { tracker, notifications, watchers } = harness({
      scan: () => new Promise((resolve) => pending.push(resolve)),
    });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(pending).toHaveLength(2);

    // 第二轮先回来：t1 被持有、正在跑
    pending[1]!(new Map([['t1', 4242]]));
    await vi.advanceTimersByTimeAsync(0);
    expect([...notifications.at(-1)!]).toEqual(['t1']);

    // 迟到的第一轮说「没人持有」——它比当前状态旧，必须被丢弃（D25）
    pending[0]!(new Map());
    await vi.advanceTimersByTimeAsync(0);

    expect(notifications).toHaveLength(1);
    expect(tracker.snapshot().has('t1')).toBe(true);
    // 连监听也不能按它的旧结论收掉，否则 t1 后续的写入就再也收不到了
    expect(watchers.get(pathOf('t1'))!.closed).toBe(false);

    tracker.dispose();
  });

  it('failed_scan_keeps_the_last_known_state', async () => {
    // 扫描失败说明不了任何会话的状态：既不能清空运行集合，也不能变成 unhandled rejection
    let fail = false;
    const scans: boolean[] = [];
    const { tracker, watchers, notifications } = harness({
      scan: async ({ fresh }) => {
        scans.push(fresh);
        if (fail) throw new Error('EMFILE: /proc');
        return new Map([['t1', 4242]]);
      },
    });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(tracker.snapshot().has('t1')).toBe(true);
    expect(notifications).toHaveLength(1);

    fail = true;
    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(tracker.snapshot().has('t1')).toBe(true);
    expect(notifications).toHaveLength(1);

    // 失败的那轮本该现扫：下一轮补上，而不是退回缓存
    fail = false;
    watchers.get(pathOf('t1'))!.fire();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(scans).toEqual([true, true, true]);

    tracker.dispose();
  });

  it('inactive_tracker_defers_recompute_until_reactivated', async () => {
    // 侧边栏切走后，回合里一行行的 rollout 写入不该再换来 /proc 扫描和 turns 查询
    let turn: Turn = doneTurn();
    const listTurns = vi.fn(async () => turn);
    const { tracker, watchers, notifications } = harness({ turns: listTurns });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(listTurns).toHaveBeenCalledTimes(1);

    const watcher = watchers.get(pathOf('t1'))!;
    turn = runningTurn();
    watcher.fire();
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
    // 已经排上的那一拍也要撤掉
    tracker.setActive(false);
    watcher.fire();
    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 10);
    expect(listTurns).toHaveBeenCalledTimes(1);
    expect(notifications).toHaveLength(0);
    // 监听照挂：重新可见之前的写入不能因为关了句柄而丢掉
    expect(watcher.closed).toBe(false);

    // 重新可见：攒下的几次变化合成一次重算
    tracker.setActive(true);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(listTurns).toHaveBeenCalledTimes(2);
    expect(notifications).toHaveLength(1);
    expect([...notifications[0]!]).toEqual(['t1']);

    tracker.dispose();
  });

  it('reactivating_without_missed_events_does_not_recompute', async () => {
    const listTurns = vi.fn(async () => runningTurn());
    const { tracker } = harness({ turns: listTurns });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(listTurns).toHaveBeenCalledTimes(1);

    tracker.setActive(false);
    tracker.setActive(true);
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 10);

    expect(listTurns).toHaveBeenCalledTimes(1);

    tracker.dispose();
  });
});
