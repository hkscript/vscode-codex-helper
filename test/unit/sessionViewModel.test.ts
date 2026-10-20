import { describe, expect, it } from 'vitest';
import type { SessionGroup } from '../../src/codex/types';
import {
  activeSessionCount,
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

  it('counts_only_running_sessions_in_visible_groups', () => {
    const groups: SessionGroup[] = [
      {
        id: 'pinned',
        label: '置顶',
        sessions: [
          {
            id: 'a',
            label: 'a',
            preview: '',
            cwd: null,
            updatedAt: 1,
            pinned: true,
            open: false,
            running: true,
            archived: false,
            tabUri: null,
          },
        ],
      },
      {
        id: 'recent',
        label: '最近',
        sessions: [
          {
            id: 'b',
            label: 'b',
            preview: '',
            cwd: null,
            updatedAt: 1,
            pinned: false,
            open: false,
            running: false,
            archived: false,
            tabUri: null,
          },
        ],
      },
    ];

    expect(activeSessionCount(groups)).toBe(1);
  });
});
