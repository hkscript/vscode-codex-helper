import { describe, expect, it } from 'vitest';
import {
  collectCwdOptions,
  cwdBasename,
  formatRelativeTime,
} from '../../src/ui/sessionViewModel';
import { makeThread } from '../helpers/fakes';

describe('sessionViewModel', () => {
  it('formats_recent_update_times_compactly', () => {
    const now = Date.UTC(2026, 9, 20, 12, 0, 0);
    const cases: Array<[number | null, string]> = [
      [now - 5_000, 'now'],
      [now - 65_000, '1m'],
      [now - 59 * 60_000, '59m'],
      [now - 3 * 3_600_000, '3h'],
      [now - 22 * 86_400_000, '22d'],
      [now - 31 * 86_400_000, '1mo'],
      [now - 400 * 86_400_000, '1y'],
      [now + 60_000, 'now'],
      [null, ''],
    ];
    for (const [updatedAt, expected] of cases) {
      expect(formatRelativeTime(updatedAt, now), String(updatedAt)).toBe(expected);
    }
  });

  it('derives_the_short_directory_label_from_both_separators', () => {
    expect(cwdBasename('/home/hk/github/vscode-codex-helper')).toBe('vscode-codex-helper');
    expect(cwdBasename('C:\\Users\\hk\\repo\\')).toBe('repo');
    expect(cwdBasename('/')).toBeUndefined();
    expect(cwdBasename('')).toBeUndefined();
    expect(cwdBasename(null)).toBeUndefined();
  });

  it('lists_directories_busiest_first_and_merges_archived_counts', () => {
    const noCwd = { ...makeThread({ id: 'd' }), cwd: null };
    const options = collectCwdOptions(
      [
        makeThread({ id: 'a', cwd: '/work/alpha' }),
        makeThread({ id: 'b', cwd: '/work/beta' }),
        makeThread({ id: 'c', cwd: '/work/beta' }),
        noCwd,
      ],
      [makeThread({ id: 'z', cwd: '/work/alpha' })],
    );

    expect(options).toEqual([
      { path: '/work/alpha', label: 'alpha', count: 2 },
      { path: '/work/beta', label: 'beta', count: 2 },
    ]);
  });
});
