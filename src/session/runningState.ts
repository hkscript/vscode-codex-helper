import type { Thread, Turn } from '../codex/types';

/**
 * Pure running-state rules (design D14/D15/D18).
 *
 * Nothing here touches the filesystem or the clock: `nowSeconds` and
 * `staleSeconds` arrive as parameters so every branch — including the
 * non-Linux time-threshold fallback — is reachable from a unit test.
 *
 * `heldRollouts === null` means "this platform cannot detect ownership"
 * (macOS / Windows). When it is a Map, ownership is authoritative and the time
 * threshold does not participate in the decision at all — that is what keeps a
 * long thinking turn from being cleared while it is still running.
 */

export const DEFAULT_STALE_SECONDS = 300;

export interface RunningStateInput {
  threads: Thread[];
  heldRollouts: Map<string, number> | null;
  nowSeconds: number;
  staleSeconds: number;
}

export interface ComputeRunningIdsInput extends RunningStateInput {
  /** threadId → latest turn. A missing key or `undefined` means "no usable record" (D24). */
  turns: Map<string, Turn | undefined>;
}

/**
 * True when the latest turn carries no terminal record.
 *
 * `inProgress` is the same-process encoding; `interrupted` + `completedAt: null`
 * is what another process sees for a turn that is still running. A non-null
 * `completedAt` always wins — a user-aborted turn writes `turn_aborted` and is
 * terminal even though its status is `interrupted` (design D15).
 */
export function hasNoTerminalRecord(turn: Turn | undefined | null): boolean {
  if (!turn) return false;
  if (turn.completedAt != null) return false;
  return turn.status === 'inProgress' || turn.status === 'interrupted';
}

function isFresh(thread: Thread, nowSeconds: number, staleSeconds: number): boolean {
  return nowSeconds - thread.updatedAt <= staleSeconds;
}

/**
 * Narrows the thread list down to the sessions worth a `thread/turns/list`
 * round trip. A running session is necessarily held by a live process, so on
 * Linux the held set is both cheap and complete (D18).
 */
export function selectCandidates(input: RunningStateInput): Thread[] {
  const { threads, heldRollouts, nowSeconds, staleSeconds } = input;
  return threads.filter((thread) => {
    if (!thread.path) return false;
    if (heldRollouts) return heldRollouts.has(thread.id);
    return isFresh(thread, nowSeconds, staleSeconds);
  });
}

export function computeRunningIds(input: ComputeRunningIdsInput): Set<string> {
  const { threads, turns, heldRollouts, nowSeconds, staleSeconds } = input;
  const running = new Set<string>();

  for (const thread of threads) {
    // No rollout file ⇒ nobody can be holding it, and "no turn yet" and "file
    // not created yet" are the same state (design 改动点 6).
    if (!thread.path) continue;
    if (!hasNoTerminalRecord(turns.get(thread.id))) continue;

    const ownerAlive = heldRollouts
      ? heldRollouts.has(thread.id)
      : isFresh(thread, nowSeconds, staleSeconds);
    if (ownerAlive) running.add(thread.id);
  }

  return running;
}
