import type { SessionGroup } from '../codex/types';

/** One directory option shown in the session sidebar's directory filter. */
export interface CwdOption {
  path: string;
  label: string;
  count: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Compact age label for the right edge of a session row: `now / 5m / 3h / 22d`.
 *
 * The sidebar is narrow, so units are deliberately short. Future timestamps
 * (clock skew between this machine and the app-server) clamp to `now`.
 */
export function formatRelativeTime(updatedAt: number | null, now: number): string {
  if (updatedAt === null || !Number.isFinite(updatedAt)) return '';
  const diff = Math.max(0, now - updatedAt);
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < MONTH) return `${Math.floor(diff / DAY)}d`;
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}mo`;
  return `${Math.floor(diff / YEAR)}y`;
}

/**
 * Last segment of a session's working directory.
 *
 * The sidebar is narrow and labels truncate from the right, so a full path
 * loses exactly the part that tells sessions apart. Accepts both separators
 * and ignores a trailing one; the root directory and the empty string have no
 * meaningful last segment and yield `undefined`.
 */
export function cwdBasename(cwd: string | null | undefined): string | undefined {
  if (!cwd) return undefined;
  const segments = cwd.split(/[/\\]+/).filter((segment) => segment.length > 0);
  return segments.at(-1);
}

/** Distinct working directories with their session counts, busiest first. */
export function collectCwdOptions(
  threads: ReadonlyArray<{ cwd: string | null }>,
  archivedThreads: ReadonlyArray<{ cwd: string | null }> = [],
): CwdOption[] {
  const counts = new Map<string, number>();
  for (const thread of [...threads, ...archivedThreads]) {
    if (!thread.cwd) continue;
    counts.set(thread.cwd, (counts.get(thread.cwd) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([path, count]) => ({ path, label: cwdBasename(path) ?? path, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

/** Number of sessions currently executing a turn in the visible groups. */
export function activeSessionCount(groups: ReadonlyArray<SessionGroup>): number {
  let count = 0;
  for (const group of groups) {
    for (const session of group.sessions) if (session.running) count += 1;
  }
  return count;
}
