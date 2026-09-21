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
  turns?: (threadId: string) => Promise<Turn | undefined>;
  watchThrows?: boolean;
  pollSeconds?: number;
}) {
  const watchers = new Map<string, FakeWatcher>();
  const notifications: Array<Set<string>> = [];
  const watchCalls: string[] = [];

  const tracker = createRunningTracker({
    scanHeldRollouts: options.held ?? (() => new Map([['t1', 4242]])),
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

  it('does_not_notify_when_running_set_unchanged', () => {
    expect.fail('TODO: implement does_not_notify_when_running_set_unchanged');
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
});
