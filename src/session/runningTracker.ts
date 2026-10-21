import type { Thread, Turn } from '../codex/types';
import { mapWithLimit } from './mapWithLimit';
import { DEFAULT_STALE_SECONDS, computeRunningIds, selectCandidates } from './runningState';

/**
 * Orchestrates the running-state pipeline: scan → narrow → query → compute,
 * re-run on rollout writes, debounced, with a polling fallback.
 *
 * Two hazards drive the shape of this module:
 *  - self-excitation: `refresh → load → update → onChange → refresh` only
 *    terminates because `onChange` fires on an actual set change (D23);
 *  - out-of-order results: one recompute waits on N `thread/turns/list` round
 *    trips and can be superseded mid-flight, so every pass carries a
 *    generation number and a late result is dropped (D25).
 */

export interface WatcherHandle {
  close(): void;
}

export interface RunningTrackerDeps {
  /**
   * `null` means this platform cannot detect ownership (non-Linux) — see D16.
   * `fresh` 为真时不得复用缓存的扫描结果（见 `heldRolloutScanner.ts`）。
   */
  scanHeldRollouts(options: { fresh: boolean }): Promise<Map<string, number> | null>;
  listTurns(threadId: string): Promise<Turn | undefined>;
  /** May throw (EMFILE, network filesystems); the tracker then polls instead. */
  watch(path: string, onChange: () => void): WatcherHandle;
  onChange(runningIds: Set<string>): void;
  now?(): number;
  debounceMs?: number;
  /** Upper bound on how long continuous events can postpone a recompute. */
  maxWaitMs?: number;
  /** `0` disables the polling fallback. */
  pollSeconds?: number;
  staleSeconds?: number;
}

export interface RunningTracker {
  /** Feed the latest thread list; schedules a debounced recompute. */
  update(threads: Thread[]): void;
  /** Recompute from the current thread list with a fresh rollout scan. */
  refresh(): void;
  snapshot(): Set<string>;
  /**
   * 结果只给侧边栏看：`false` 期间的 rollout 写入、轮询和 `update` 只记一笔不重算
   * （监听照挂），重新 `true` 时若有漏掉的就补算一次。默认 `true`。
   */
  setActive(active: boolean): void;
  dispose(): void;
}

export const DEFAULT_DEBOUNCE_MS = 300;
export const DEFAULT_MAX_WAIT_MS = 1500;
export const DEFAULT_POLL_SECONDS = 5;
/** Keeps one burst of `thread/turns/list` from saturating the app-server. */
const MAX_CONCURRENT_QUERIES = 4;

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

export function createRunningTracker(deps: RunningTrackerDeps): RunningTracker {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxWaitMs = deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const pollMs = (deps.pollSeconds ?? DEFAULT_POLL_SECONDS) * 1000;
  const staleSeconds = deps.staleSeconds ?? DEFAULT_STALE_SECONDS;
  const now = deps.now ?? (() => Date.now());

  const watchers = new Map<string, WatcherHandle>();
  let threads: Thread[] = [];
  let running = new Set<string>();
  let generation = 0;
  let needsFreshScan = false;
  let active = true;
  let missedWhileInactive = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  function startPolling(): void {
    if (disposed || pollTimer || pollMs <= 0) return;
    pollTimer = setInterval(schedule, pollMs);
  }

  function armWatchers(candidates: Thread[]): void {
    if (disposed) return;
    const wanted = new Set<string>();
    for (const thread of candidates) if (thread.path) wanted.add(thread.path);

    for (const [path, handle] of [...watchers]) {
      if (wanted.has(path)) continue;
      try {
        handle.close();
      } catch {
        // A watcher whose file already vanished throws on close; nothing to do.
      }
      watchers.delete(path);
    }

    for (const path of wanted) {
      if (watchers.has(path)) continue;
      try {
        watchers.set(path, deps.watch(path, schedule));
      } catch {
        startPolling();
      }
    }
  }

  function clearScheduledRecompute(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = undefined;
    if (maxWaitTimer) clearTimeout(maxWaitTimer);
    maxWaitTimer = undefined;
  }

  function runScheduledRecompute(): void {
    clearScheduledRecompute();
    void recompute();
  }

  function schedule(): void {
    if (disposed) return;
    if (!active) {
      missedWhileInactive = true;
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runScheduledRecompute, debounceMs);
    if (!maxWaitTimer) {
      maxWaitTimer = setTimeout(runScheduledRecompute, maxWaitMs);
    }
  }

  async function recompute(): Promise<void> {
    if (disposed) return;
    const pass = ++generation;

    // 新的线程列表可能带来刚起跑的会话：它的 rollout 不在稍早那份扫描里，复用缓存就会
    // 判它不是候选、不挂监听，之后未必还有事件再触发重算。候选的 rollout 写入和轮询
    // 则会接连到来，复用 ttl 内的扫描结果、晚一点看到变化无妨。
    const fresh = needsFreshScan;
    needsFreshScan = false;

    let heldRollouts: Map<string, number> | null;
    try {
      heldRollouts = await deps.scanHeldRollouts({ fresh });
    } catch {
      // 扫描本身失败：保留上一轮的结论，等下一次事件再算
      if (fresh) needsFreshScan = true;
      return;
    }
    // 扫描期间被 dispose（不能再挂监听、发回调），或已有更新的一轮在跑（D25）
    if (disposed || pass !== generation) return;

    const nowSeconds = Math.floor(now() / 1000);
    const candidates = selectCandidates({ threads, heldRollouts, nowSeconds, staleSeconds });
    armWatchers(candidates);

    const turns = new Map<string, Turn | undefined>();
    await mapWithLimit(candidates, MAX_CONCURRENT_QUERIES, async (thread) => {
      try {
        turns.set(thread.id, await deps.listTurns(thread.id));
      } catch {
        // D24: one failed query means "not running", not a broken tree.
        turns.set(thread.id, undefined);
      }
    });

    // A newer pass started while we were waiting: its result is the current
    // truth, so this one is stale no matter what it says (D25).
    if (disposed || pass !== generation) return;

    const next = computeRunningIds({
      threads: candidates,
      turns,
      heldRollouts,
      nowSeconds,
      staleSeconds,
    });
    if (sameSet(next, running)) return;
    running = next;
    deps.onChange(new Set(next));
  }

  return {
    update(nextThreads: Thread[]): void {
      if (disposed) return;
      threads = nextThreads;
      needsFreshScan = true;
      schedule();
    },

    refresh(): void {
      if (disposed) return;
      needsFreshScan = true;
      schedule();
    },

    snapshot(): Set<string> {
      return new Set(running);
    },

    setActive(next: boolean): void {
      if (disposed || next === active) return;
      active = next;
      if (!active) {
        // 已经排上、还没开跑的那一拍也挪到重新可见时再算
        if (debounceTimer || maxWaitTimer) {
          clearScheduledRecompute();
          missedWhileInactive = true;
        }
        return;
      }
      if (!missedWhileInactive) return;
      missedWhileInactive = false;
      schedule();
    },

    dispose(): void {
      disposed = true;
      clearScheduledRecompute();
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
      for (const handle of watchers.values()) {
        try {
          handle.close();
        } catch {
          // best effort
        }
      }
      watchers.clear();
    },
  };
}
