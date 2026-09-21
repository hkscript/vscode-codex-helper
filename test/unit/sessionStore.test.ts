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
    const groups = buildSessionGroups({
      threads,
      openTabs: [makeOpenTab('pin-1', '置顶一')],
      pinnedIds: ['pin-1'],
    });

    // 本次语义翻转（design §6.2 第 1 行）：打开一个置顶会话不再把它从置顶组掏空
    expect(ids(groups, 'open')).toEqual(['pin-1']);
    expect(ids(groups, 'pinned')).toEqual(['pin-1']);
    expect(occurrences(groups, 'pin-1')).toBe(2);
    // 历史组仍与另两组互斥
    expect(ids(groups, 'history')).toEqual(['hist-1', 'hist-2', 'open-1']);

    const pinnedRow = groups.find((group) => group.id === 'pinned')!.sessions[0]!;
    const openRow = groups.find((group) => group.id === 'open')!.sessions[0]!;
    // 两行都得如实说出「这个会话既开着又被置顶」，否则条目上看不出置顶
    expect(pinnedRow.pinned).toBe(true);
    expect(openRow.pinned).toBe(true);
    expect(pinnedRow.open).toBe(true);
    expect(openRow.open).toBe(true);
  });

  it('unpinning_removes_pinned_row_but_keeps_open_row', () => {
    const before = buildSessionGroups({
      threads,
      openTabs: [makeOpenTab('pin-1', '置顶一')],
      pinnedIds: ['pin-1'],
    });
    expect(occurrences(before, 'pin-1')).toBe(2);

    const after = buildSessionGroups({
      threads,
      openTabs: [makeOpenTab('pin-1', '置顶一')],
      pinnedIds: [],
    });

    // 取消置顶：置顶组那行消失，已打开那行保留且不再带置顶标记
    expect(after.find((group) => group.id === 'pinned')).toBeUndefined();
    expect(ids(after, 'open')).toEqual(['pin-1']);
    expect(after.find((group) => group.id === 'open')!.sessions[0]!.pinned).toBe(false);
    expect(occurrences(after, 'pin-1')).toBe(1);
  });

  it('marks_sessions_present_in_running_set', () => {
    const groups = buildSessionGroups({
      threads,
      openTabs: [makeOpenTab('open-1', '已打开一')],
      pinnedIds: ['pin-1'],
      runningIds: ['open-1', 'hist-2'],
    });

    const rows = groups.flatMap((group) => group.sessions);
    const runningIds = rows.filter((session) => session.running).map((session) => session.id).sort();

    expect(runningIds).toEqual(['hist-2', 'open-1']);
    // running 必须是明确的布尔值，不能是 undefined 蒙混过去
    for (const session of rows) {
      expect(typeof session.running, `${session.id}.running`).toBe('boolean');
    }
  });

  // INV-002: design §6.2 的 (hasOpenTab × pinned × inThreadList) 8 格全组合
  it('group_membership_matrix_holds_for_all_combinations', () => {
    const target = 's1';
    let checked = 0;
    let openRows = 0;
    let pinnedRows = 0;
    let historyRows = 0;

    for (const hasOpenTab of [true, false]) {
      for (const pinned of [true, false]) {
        for (const inThreadList of [true, false]) {
          const groups = buildSessionGroups({
            threads: inThreadList
              ? [makeThread({ id: target, name: '目标会话' }), threads[0]!]
              : [threads[0]!],
            openTabs: hasOpenTab
              ? [makeOpenTab(target, '目标会话'), makeOpenTab('other', '其他')]
              : [],
            pinnedIds: pinned ? [target] : [],
          });

          const label = `(open=${hasOpenTab}, pinned=${pinned}, listed=${inThreadList})`;
          // 独立推导的期望：已打开看标签页；置顶还要求服务端查得到（D8 幽灵置顶丢弃）；
          // 历史 = 服务端有 且 既没打开也没置顶
          const inOpen = hasOpenTab;
          const inPinned = pinned && inThreadList;
          const inHistory = inThreadList && !inOpen && !inPinned;

          expect(ids(groups, 'open').includes(target), `${label} open`).toBe(inOpen);
          expect(ids(groups, 'pinned').includes(target), `${label} pinned`).toBe(inPinned);
          expect(ids(groups, 'history').includes(target), `${label} history`).toBe(inHistory);
          // 历史组与另两组仍然互斥——这条不变量本次没有被推翻
          expect(inHistory && (inOpen || inPinned), `${label} 历史组互斥`).toBe(false);
          expect(occurrences(groups, target), `${label} 行数`).toBe(
            Number(inOpen) + Number(inPinned) + Number(inHistory),
          );

          checked += 1;
          openRows += Number(inOpen);
          pinnedRows += Number(inPinned);
          historyRows += Number(inHistory);
        }
      }
    }

    // 反空转护栏：8 格必须全部跑到，且三种归属都真的出现过
    expect(checked).toBe(8);
    expect(openRows).toBe(4);
    expect(pinnedRows).toBe(2);
    expect(historyRows).toBe(1);
  });
});
