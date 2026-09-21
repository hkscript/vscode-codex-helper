import type { Thread, Turn } from '../codex/types';
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
  /** `null` means this platform cannot detect ownership (non-Linux) — see D16. */
  scanHeldRollouts(): Map<string, number> | null;
  listTurns(threadId: string): Promise<Turn | undefined>;
  /** May throw (EMFILE, network filesystems); the tracker then polls instead. */
  watch(path: string, onChange: () => void): WatcherHandle;
  onChange(runningIds: Set<string>): void;
  now?(): number;
  debounceMs?: number;
  /** `0` disables the polling fallback. */
  pollSeconds?: number;
  staleSeconds?: number;
}

export interface RunningTracker {
  /** Feed the latest thread list; schedules a debounced recompute. */
  update(threads: Thread[]): void;
  snapshot(): Set<string>;
  dispose(): void;
}

export const DEFAULT_DEBOUNCE_MS = 300;
export const DEFAULT_POLL_SECONDS = 5;
/** Keeps one burst of `thread/turns/list` from saturating the app-server. */
const MAX_CONCURRENT_QUERIES = 4;

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

async function mapWithLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export function createRunningTracker(deps: RunningTrackerDeps): RunningTracker {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const pollMs = (deps.pollSeconds ?? DEFAULT_POLL_SECONDS) * 1000;
  const staleSeconds = deps.staleSeconds ?? DEFAULT_STALE_SECONDS;
  const now = deps.now ?? (() => Date.now());

  const watchers = new Map<string, WatcherHandle>();
  let threads: Thread[] = [];
  let running = new Set<string>();
  let generation = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
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

  function schedule(): void {
    if (disposed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void recompute();
    }, debounceMs);
  }

  async function recompute(): Promise<void> {
    if (disposed) return;
    const pass = ++generation;

    const heldRollouts = deps.scanHeldRollouts();
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
      schedule();
    },

    snapshot(): Set<string> {
      return new Set(running);
    },

    dispose(): void {
      disposed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = undefined;
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
