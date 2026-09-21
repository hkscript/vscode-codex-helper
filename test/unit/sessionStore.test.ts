import { describe, expect, it } from 'vitest';
import type { SessionGroup, SessionGroupId } from '../../src/codex/types';
import { buildSessionGroups, matchesFilter } from '../../src/session/sessionStore';
import { makeOpenTab, makeThread } from '../helpers/fakes';

const threads = [
  makeThread({ id: 'hist-1', name: '历史一', preview: '历史一预览', updatedAt: 10 }),
  makeThread({ id: 'hist-2', name: '历史二', preview: '历史二预览', updatedAt: 20 }),
  makeThread({ id: 'pin-1', name: '置顶一', preview: '置顶一预览', updatedAt: 30 }),
  makeThread({ id: 'open-1', name: '已打开一', preview: '已打开一预览', updatedAt: 40 }),
];

function ids(groups: SessionGroup[], groupId: SessionGroupId): string[] {
  const group = groups.find((entry) => entry.id === groupId);
  return group ? group.sessions.map((session) => session.id).sort() : [];
}

function allIds(groups: SessionGroup[]): string[] {
  return groups.flatMap((group) => group.sessions.map((session) => session.id));
}

function occurrences(groups: SessionGroup[], id: string): number {
  return allIds(groups).filter((entry) => entry === id).length;
}

describe('sessionStore', () => {
  it('assigns_sessions_to_open_pinned_history_groups', () => {
    const groups = buildSessionGroups({
      threads,
      openTabs: [makeOpenTab('open-1', '已打开一')],
      pinnedIds: ['pin-1'],
    });

    expect(groups.map((group) => group.id)).toEqual(['open', 'pinned', 'history']);
    expect(ids(groups, 'open')).toEqual(['open-1']);
    expect(ids(groups, 'pinned')).toEqual(['pin-1']);
    expect(ids(groups, 'history')).toEqual(['hist-1', 'hist-2']);
    expect(groups.map((group) => group.label)).toEqual(['已打开', '置顶', '历史']);
  });

  it('open_group_wins_over_pinned_group', () => {
    const groups = buildSessionGroups({
      threads,
      openTabs: [makeOpenTab('pin-1', '置顶一')],
      pinnedIds: ['pin-1'],
    });

    expect(ids(groups, 'open')).toEqual(['pin-1']);
    expect(groups.find((group) => group.id === 'pinned')).toBeUndefined();
    expect(occurrences(groups, 'pin-1')).toBe(1);
  });

  it('hides_empty_groups', () => {
    const onlyHistory = buildSessionGroups({
      threads: [threads[0]!],
      openTabs: [],
      pinnedIds: [],
    });
    expect(onlyHistory.map((group) => group.id)).toEqual(['history']);

    const nothing = buildSessionGroups({ threads: [], openTabs: [], pinnedIds: [] });
    expect(nothing).toEqual([]);
  });

  it('filter_keeps_only_matching_sessions', () => {
    const groups = buildSessionGroups({
      threads,
      openTabs: [makeOpenTab('open-1', '已打开一')],
      pinnedIds: ['pin-1'],
      filter: '历史',
    });

    expect(groups.map((group) => group.id)).toEqual(['history']);
    expect(ids(groups, 'history')).toEqual(['hist-1', 'hist-2']);

    // 关键词大小写不敏感，且 id 也参与匹配
    const byId = buildSessionGroups({
      threads,
      openTabs: [],
      pinnedIds: [],
      filter: 'PIN-1',
    });
    expect(ids(byId, 'history')).toEqual(['pin-1']);
  });

  it('falls_back_to_preview_when_name_is_null', () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 'anon', name: null, preview: '帮我看看这个报价' }),
        makeThread({ id: 'blank', name: '   ', preview: '预览文本' }),
        makeThread({ id: 'named', name: '价格排查', preview: '不该出现' }),
      ],
      openTabs: [],
      pinnedIds: [],
    });

    const history = groups.find((group) => group.id === 'history')!;
    const labelOf = (id: string) => history.sessions.find((s) => s.id === id)!.label;

    expect(labelOf('anon')).toBe('帮我看看这个报价');
    expect(labelOf('blank')).toBe('预览文本');
    expect(labelOf('named')).toBe('价格排查');
  });

  it('drops_pinned_session_that_no_longer_exists', () => {
    const groups = buildSessionGroups({
      threads: [threads[0]!],
      openTabs: [],
      pinnedIds: ['ghost'],
    });

    expect(groups.map((group) => group.id)).toEqual(['history']);
    expect(allIds(groups)).not.toContain('ghost');
  });

  it('keeps_open_tab_session_missing_from_thread_list', () => {
    const groups = buildSessionGroups({
      threads: [threads[0]!],
      openTabs: [makeOpenTab('open-unknown', '新会话')],
      pinnedIds: [],
    });

    expect(ids(groups, 'open')).toEqual(['open-unknown']);
    const open = groups.find((group) => group.id === 'open')!;
    expect(open.sessions[0]!.label).toBe('新会话');

    // 未绑定会话的新建标签同样保留（id 为 null，用合成 id 保证唯一）
    const withNewPanel = buildSessionGroups({
      threads: [threads[0]!],
      openTabs: [makeOpenTab(null, 'New chat'), makeOpenTab(null, 'New chat')],
      pinnedIds: [],
    });
    expect(ids(withNewPanel, 'open')).toHaveLength(2);
  });

  it('every_session_appears_in_exactly_one_group', () => {
    const target = 's1';
    let visible = 0;
    let dropped = 0;

    for (const hasOpenTab of [true, false]) {
      for (const pinned of [true, false]) {
        for (const inThreadList of [true, false]) {
          const groups = buildSessionGroups({
            threads: inThreadList
              ? [makeThread({ id: target, name: '目标会话' }), threads[0]!]
              : [threads[0]!],
            openTabs: hasOpenTab ? [makeOpenTab(target, '目标会话'), makeOpenTab('other', '其他')] : [],
            pinnedIds: pinned ? [target] : [],
          });

          const seen = occurrences(groups, target);
          expect(seen, `hasOpenTab=${hasOpenTab} pinned=${pinned} inThreadList=${inThreadList}`).toBeLessThanOrEqual(1);

          // 正空间断言：有标签页或在服务端列表里 ⇒ 必须恰好出现一次
          if (hasOpenTab || inThreadList) {
            expect(seen, `组合 (${hasOpenTab},${pinned},${inThreadList}) 应当可见`).toBe(1);
            visible += 1;
          } else {
            // 只被置顶、服务端与标签页都查无此人 ⇒ 幽灵条目必须丢弃
            expect(seen, `组合 (${hasOpenTab},${pinned},${inThreadList}) 应当丢弃`).toBe(0);
            dropped += 1;
          }
        }
      }
    }

    // 防止上面的循环被写成永远不进循环的假绿
    expect(visible).toBe(6);
    expect(dropped).toBe(2);
  });

  it('every_rendered_session_matches_active_filter', () => {
    const keywords = ['', '历史', 'OPEN-1', 'zzz-不存在的关键词'];
    let rendered = 0;
    let matchedNonEmpty = 0;

    for (const keyword of keywords) {
      for (const filter of [keyword, keyword.toLowerCase()]) {
        const groups = buildSessionGroups({
          threads,
          openTabs: [makeOpenTab('open-tab-only', '标签兜底会话')],
          pinnedIds: ['pin-1'],
          filter,
        });

        for (const group of groups) {
          for (const session of group.sessions) {
            // 用独立推导的谓词复核，避免拿被测函数自证
            expect(matchesFilter(session, filter), `${session.id} 出现在 ${group.id} 组`).toBe(true);
            if (filter.trim().length > 0) {
              const haystack = `${session.id} ${session.label} ${session.preview}`.toLowerCase();
              expect(haystack.includes(filter.trim().toLowerCase()), `${session.id} 不匹配关键词 ${filter}`).toBe(true);
              matchedNonEmpty += 1;
            }
            rendered += 1;
          }
        }
      }
    }

    expect(rendered).toBeGreaterThan(0);
    expect(matchedNonEmpty).toBeGreaterThan(0);
  });

  // REQ: 新建会话 / Scenario: 尚未绑定会话的新建标签以未命名项出现在「已打开」组
  it('shows_unnamed_new_panel_in_open_group', () => {
    const groups = buildSessionGroups({
      threads: [threads[0]!],
      openTabs: [makeOpenTab(null, 'New chat'), makeOpenTab(null, 'New chat')],
      pinnedIds: [],
    });

    const open = groups.find((group) => group.id === 'open')!;
    // 两个标签都没有 conversationId，但必须各占一项，不能因为 id 都是 null 而互相覆盖
    expect(open.sessions).toHaveLength(2);
    expect(open.sessions.map((session) => session.label)).toEqual(['New chat', 'New chat']);
    expect(new Set(open.sessions.map((session) => session.id)).size).toBe(2);
    // 未绑定会话的标签只出现在「已打开」组，不会被算进历史
    expect(allIds(groups).filter((id) => id.startsWith('open-tab:'))).toHaveLength(2);
    expect(ids(groups, 'history')).toEqual(['hist-1']);
  });

  it('pinned_session_stays_in_pinned_group_when_open', () => {
    expect.fail('TODO: implement pinned_session_stays_in_pinned_group_when_open');
  });

  it('unpinning_removes_pinned_row_but_keeps_open_row', () => {
    expect.fail('TODO: implement unpinning_removes_pinned_row_but_keeps_open_row');
  });

  it('marks_sessions_present_in_running_set', () => {
    expect.fail('TODO: implement marks_sessions_present_in_running_set');
  });

  // INV-002: design §6.2 全组合遍历（取代 every_session_appears_in_exactly_one_group）
  it('group_membership_matrix_holds_for_all_combinations', () => {
    expect.fail('TODO: implement group_membership_matrix_holds_for_all_combinations');
  });
});
