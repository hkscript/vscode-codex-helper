import { describe, expect, it } from 'vitest';
import type { SessionGroup, SessionGroupId, Thread } from '../../src/codex/types';
import { scanCodexTabs } from '../../src/session/openTabs';
import { RECENT_LIMIT, buildSessionGroups, matchesFilter } from '../../src/session/sessionStore';
import { createFakeUriApi, makeOpenTab, makeThread } from '../helpers/fakes';

const uriApi = createFakeUriApi();

/** n 个未置顶会话，`updatedAt` 从大到小（t1 最新）。 */
function manyThreads(count: number, start = 100): Thread[] {
  return Array.from({ length: count }, (_, index) =>
    makeThread({
      id: `t${index + 1}`,
      name: `会话${index + 1}`,
      preview: `会话${index + 1}预览`,
      updatedAt: start - index,
    }),
  );
}

function ids(groups: SessionGroup[], groupId: SessionGroupId): string[] {
  const group = groups.find((entry) => entry.id === groupId);
  return group ? group.sessions.map((session) => session.id) : [];
}

function allIds(groups: SessionGroup[]): string[] {
  return groups.flatMap((group) => group.sessions.map((session) => session.id));
}

function rows(groups: SessionGroup[]) {
  return groups.flatMap((group) => group.sessions);
}

function occurrences(groups: SessionGroup[], id: string): number {
  return allIds(groups).filter((entry) => entry === id).length;
}

describe('sessionStore', () => {
  // REQ: 树视图分组 / Scenario: 三组分别归位 + 已归档的会话只出现在已归档分组
  it('renders_pinned_recent_history_and_archived_groups', () => {
    const groups = buildSessionGroups({
      threads: manyThreads(12),
      archivedThreads: [makeThread({ id: 'z1', name: '归档的', updatedAt: 200 })],
      openTabs: [],
      pinnedIds: ['t1'],
    });

    expect(groups.map((group) => group.id)).toEqual(['pinned', 'recent', 'history', 'archived']);
    expect(groups.map((group) => group.label)).toEqual(['置顶', '最近', '历史', '已归档']);
    expect(ids(groups, 'pinned')).toEqual(['t1']);
    expect(ids(groups, 'recent')).toEqual(Array.from({ length: RECENT_LIMIT }, (_, i) => `t${i + 2}`));
    expect(ids(groups, 'history')).toEqual(['t12']);
    expect(ids(groups, 'archived')).toEqual(['z1']);
  });

  // REQ: 树视图分组 / Scenario: 已打开的会话出现在最近或历史分组
  it('open_session_row_lands_in_recent_with_open_mark', () => {
    const tab = makeOpenTab('t2', '正在用的');
    const groups = buildSessionGroups({
      threads: manyThreads(3),
      openTabs: [tab],
      pinnedIds: [],
    });

    const row = rows(groups).find((session) => session.id === 't2');
    expect(ids(groups, 'recent')).toContain('t2');
    expect(row?.open).toBe(true);
    // 已打开的行必须带上该标签自己的 resource，否则点击只能靠会话 id 重拼
    expect(row?.tabUri).toEqual(tab.uri);
    expect(ids(groups, 'history')).not.toContain('t2');
  });

  // REQ: 树视图分组 / Scenario: 尚未绑定会话的新面板不产生任何条目（核心回归）
  it('drops_unbound_new_panel_tab', () => {
    // 真实链路：扫描 → 建树。未绑定会话的面板标签以前只会产生 open-tab:<n> 合成 id，
    // 点一下就去打开一个不存在的会话（生产日志 conversationId=open-tab:0）。
    const scanned = scanCodexTabs({
      all: [
        {
          tabs: [
            {
              label: 'Codex',
              input: {
                uri: uriApi
                  .file('/extension/panel/new')
                  .with({ scheme: 'openai-codex', authority: 'route', query: 'newPanel=n1' }),
                viewType: 'chatgpt.conversationEditor',
              },
            },
          ],
        },
      ],
    });
    const groups = buildSessionGroups({
      threads: manyThreads(2),
      openTabs: scanned,
      pinnedIds: [],
    });

    expect(scanned).toEqual([]);
    expect(allIds(groups).filter((id) => id.startsWith('open-tab:'))).toEqual([]);
    expect(ids(groups, 'recent')).toEqual(['t1', 't2']);
  });

  // REQ: 树视图分组 / Scenario: 置顶会话被打开后仍保留在置顶组且只有一行
  it('pinned_open_session_keeps_single_pinned_row', () => {
    const groups = buildSessionGroups({
      threads: manyThreads(3),
      openTabs: [makeOpenTab('t1', '钉住又开着的')],
      pinnedIds: ['t1'],
    });

    expect(ids(groups, 'pinned')).toEqual(['t1']);
    expect(ids(groups, 'recent')).not.toContain('t1');
    expect(ids(groups, 'history')).not.toContain('t1');
    expect(occurrences(groups, 't1')).toBe(1);
    const row = rows(groups).find((session) => session.id === 't1');
    expect(row?.pinned).toBe(true);
    expect(row?.open).toBe(true);
  });

  // REQ: 会话置顶与取消置顶后的归位 / Scenario: 取消置顶的已打开会话按最近度归位
  it('unpinning_moves_open_session_to_recent', () => {
    const before = buildSessionGroups({
      threads: manyThreads(3),
      openTabs: [makeOpenTab('t1', '钉住又开着的')],
      pinnedIds: ['t1'],
    });
    expect(ids(before, 'pinned')).toEqual(['t1']);

    const after = buildSessionGroups({
      threads: manyThreads(3),
      openTabs: [makeOpenTab('t1', '钉住又开着的')],
      pinnedIds: [],
    });

    expect(after.find((group) => group.id === 'pinned')).toBeUndefined();
    expect(ids(after, 'recent')).toContain('t1');
    expect(occurrences(after, 't1')).toBe(1);
    // 「已打开」组已删除：开着的会话就在最近/历史里，靠标记表达
    expect(rows(after).find((session) => session.id === 't1')?.open).toBe(true);
  });

  // REQ: 树视图分组 / Scenario: 已打开但服务端列表里没有的会话不渲染
  it('drops_open_tab_whose_thread_is_missing', () => {
    const groups = buildSessionGroups({
      threads: manyThreads(2),
      openTabs: [makeOpenTab('ghost', '服务端没有的')],
      pinnedIds: [],
    });

    expect(allIds(groups)).not.toContain('ghost');
    expect(ids(groups, 'recent')).toEqual(['t1', 't2']);
  });

  // REQ: 树视图分组 / Scenario: 最近分组只取最近更新的 10 个未置顶会话
  it('recent_group_takes_ten_most_recent_unpinned', () => {
    const groups = buildSessionGroups({
      threads: manyThreads(12, 120),
      openTabs: [],
      pinnedIds: [],
    });

    expect(ids(groups, 'recent')).toHaveLength(RECENT_LIMIT);
    // 按 updatedAt 倒序：120、119、…、111
    expect(ids(groups, 'recent')).toEqual(Array.from({ length: RECENT_LIMIT }, (_, i) => `t${i + 1}`));
    expect(ids(groups, 'history')).toEqual(['t11', 't12']);
  });

  // REQ: 树视图分组 / Scenario: 未置顶会话不足 10 个时最近分组全收
  it('recent_group_holds_all_when_fewer_than_ten', () => {
    const groups = buildSessionGroups({ threads: manyThreads(3), openTabs: [], pinnedIds: [] });

    expect(ids(groups, 'recent')).toEqual(['t1', 't2', 't3']);
    expect(groups.map((group) => group.id)).toEqual(['recent']);
  });

  // REQ: 树视图分组 / Scenario: 置顶的会话不出现在最近分组
  it('pinned_session_leaves_recent_group', () => {
    const groups = buildSessionGroups({
      threads: manyThreads(12),
      openTabs: [],
      pinnedIds: ['t1'],
    });

    expect(ids(groups, 'pinned')).toEqual(['t1']);
    expect(ids(groups, 'recent')).not.toContain('t1');
    expect(ids(groups, 'recent')).toHaveLength(RECENT_LIMIT);
  });

  // REQ: 树视图分组 / Scenario: 最近与历史互斥
  it('recent_and_history_are_disjoint', () => {
    const groups = buildSessionGroups({ threads: manyThreads(12), openTabs: [], pinnedIds: [] });
    const recent = new Set(ids(groups, 'recent'));
    const history = ids(groups, 'history');

    expect(history.length).toBeGreaterThan(0);
    expect(history.filter((id) => recent.has(id))).toEqual([]);
  });

  // REQ: 树视图分组 / Scenario: 已归档的会话只出现在已归档分组
  it('archived_threads_land_in_archived_group_only', () => {
    const groups = buildSessionGroups({
      threads: manyThreads(3),
      archivedThreads: [
        makeThread({ id: 'z1', name: '归档一', updatedAt: 500 }),
        makeThread({ id: 'z2', name: '归档二', updatedAt: 400 }),
      ],
      openTabs: [],
      pinnedIds: [],
    });

    expect(ids(groups, 'archived')).toEqual(['z1', 'z2']);
    expect(ids(groups, 'pinned')).not.toContain('z1');
    expect(ids(groups, 'recent')).not.toContain('z1');
    expect(ids(groups, 'history')).not.toContain('z1');
    expect(rows(groups).find((session) => session.id === 'z1')?.archived).toBe(true);
    expect(rows(groups).find((session) => session.id === 't1')?.archived).toBe(false);
  });

  // REQ: 树视图分组 / Scenario: 置顶的已归档会话仍在已归档分组且带置顶标识
  it('pinned_archived_session_still_marked_pinned', () => {
    const groups = buildSessionGroups({
      threads: manyThreads(3),
      archivedThreads: [makeThread({ id: 'z1', name: '归档一', updatedAt: 500 })],
      openTabs: [],
      pinnedIds: ['z1'],
    });

    expect(ids(groups, 'archived')).toEqual(['z1']);
    expect(ids(groups, 'pinned')).toEqual([]);
    // 置顶状态跨归档保留：取消归档后它会回到「置顶」组
    expect(rows(groups).find((session) => session.id === 'z1')?.pinned).toBe(true);
    expect(occurrences(groups, 'z1')).toBe(1);
  });

  // INV-002: 任何分组都不出现未绑定面板行
  it('no_unbound_panel_row_ever_rendered', () => {
    const unboundTab = (nonce: string) => ({
      label: 'Codex',
      input: {
        uri: uriApi
          .file('/extension/panel/new')
          .with({ scheme: 'openai-codex', authority: 'route', query: `newPanel=${nonce}` }),
        viewType: 'chatgpt.conversationEditor',
      },
    });
    const boundTab = (id: string) => ({
      label: `会话 ${id}`,
      input: {
        uri: uriApi.file(`/local/${id}`).with({ scheme: 'openai-codex', authority: 'route', query: '' }),
        viewType: 'chatgpt.conversationEditor',
      },
    });
    const tabSets = [
      [],
      [unboundTab('n1')],
      [unboundTab('n1'), unboundTab('n2')],
      [boundTab('t1'), unboundTab('n3')],
    ];

    let checked = 0;
    for (const tabs of tabSets) {
      for (const threadCount of [0, 1, 12]) {
        const groups = buildSessionGroups({
          threads: manyThreads(threadCount),
          archivedThreads: [makeThread({ id: 'z1', name: '归档的', updatedAt: 900 })],
          openTabs: scanCodexTabs({ all: [{ tabs }] }),
          pinnedIds: [],
        });

        // 合成 id 一律不得出现；归档会话必须仍然渲染（模板不受空标签集合影响）
        expect(allIds(groups).filter((id) => !/^[tz]\d+$/.test(id))).toEqual([]);
        expect(ids(groups, 'archived')).toEqual(['z1']);
        checked += 1;
      }
    }
    expect(checked).toBe(12);
  });

  // INV-003: 每个会话恰好渲染一行（已归档 / 置顶 / 最近 / 历史 唯一归属）
  it('every_thread_renders_exactly_once', () => {
    let checked = 0;
    let pinnedRows = 0;
    let recentRows = 0;
    let historyRows = 0;
    let archivedRows = 0;

    for (const pinned of [false, true]) {
      for (const archived of [false, true]) {
        for (const size of [1, 12]) {
          const target = 'target';
          // size=1：目标就是唯一会话（必进「最近」）；size=12：目标是列表里最老的
          // 一个（未置顶未归档时必进「历史」）——两格合起来才能覆盖到「历史」。
          const threads =
            size === 1
              ? [makeThread({ id: target, name: '目标', updatedAt: 100 })]
              : [makeThread({ id: target, name: '目标', updatedAt: 1 }), ...manyThreads(11, 100)];
          const groups = buildSessionGroups({
            threads,
            archivedThreads: archived
              ? [makeThread({ id: target, name: '归档的 t1', updatedAt: 900 })]
              : [],
            openTabs: [makeOpenTab(target, '开着的')],
            pinnedIds: pinned ? [target] : [],
          });

          const label = `(pinned=${pinned}, archived=${archived}, size=${size})`;
          expect(occurrences(groups, target), `${label} 行数`).toBe(1);
          expect(ids(groups, 'archived').includes(target), `${label} 归档优先`).toBe(archived);
          expect(ids(groups, 'pinned').includes(target), `${label} 置顶`).toBe(pinned && !archived);
          // 「最近」只收最新的 RECENT_LIMIT 个：size=1 时目标就是最新，size=12 时目标最老
          expect(ids(groups, 'recent').includes(target), `${label} 最近`).toBe(
            !pinned && !archived && size === 1,
          );
          expect(ids(groups, 'history').includes(target), `${label} 历史`).toBe(
            !pinned && !archived && size === 12,
          );

          pinnedRows += Number(ids(groups, 'pinned').includes(target));
          recentRows += Number(ids(groups, 'recent').includes(target));
          historyRows += Number(ids(groups, 'history').includes(target));
          archivedRows += Number(ids(groups, 'archived').includes(target));
          checked += 1;
        }
      }
    }

    // 反空转护栏：8 格必须全部跑到，且四种归属都真的出现过
    expect(checked).toBe(8);
    expect(pinnedRows).toBe(2);
    expect(recentRows).toBe(1);
    expect(historyRows).toBe(1);
    expect(archivedRows).toBe(4);
  });

  it('filter_keeps_only_matching_sessions', () => {
    const groups = buildSessionGroups({
      threads: manyThreads(12),
      openTabs: [],
      pinnedIds: [],
      filter: '会话1',
    });

    // 过滤跨四组生效：只留下名字/id 命中的行
    const rendered = rows(groups);
    expect(rendered.length).toBeGreaterThan(0);
    for (const session of rendered) {
      expect(`${session.id} ${session.label} ${session.preview}`.toLowerCase()).toContain('会话1');
    }

    // 关键词大小写不敏感，且 id 也参与匹配
    const byId = buildSessionGroups({ threads: manyThreads(12), openTabs: [], pinnedIds: [], filter: 'T11' });
    expect(ids(byId, 'history')).toEqual(['t11']);
  });

  it('falls_back_to_preview_when_name_is_null', () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 'anon', name: null, preview: '帮我看看这个报价', updatedAt: 3 }),
        makeThread({ id: 'blank', name: '   ', preview: '预览文本', updatedAt: 2 }),
        makeThread({ id: 'named', name: '价格排查', preview: '不该出现', updatedAt: 1 }),
      ],
      openTabs: [],
      pinnedIds: [],
    });

    const labelOf = (id: string) => rows(groups).find((session) => session.id === id)!.label;

    expect(labelOf('anon')).toBe('帮我看看这个报价');
    expect(labelOf('blank')).toBe('预览文本');
    expect(labelOf('named')).toBe('价格排查');
  });

  it('drops_pinned_session_that_no_longer_exists', () => {
    const groups = buildSessionGroups({
      threads: manyThreads(2),
      openTabs: [],
      pinnedIds: ['ghost'],
    });

    expect(allIds(groups)).not.toContain('ghost');
    expect(groups.map((group) => group.id)).toEqual(['recent']);
  });

  it('hides_empty_groups', () => {
    expect(buildSessionGroups({ threads: [], openTabs: [], pinnedIds: [] })).toEqual([]);
    expect(
      buildSessionGroups({
        threads: [],
        archivedThreads: [makeThread({ id: 'z1', name: '归档的' })],
        openTabs: [],
        pinnedIds: [],
      }).map((group) => group.id),
    ).toEqual(['archived']);
  });

  it('every_rendered_session_matches_active_filter', () => {
    const keywords = ['', '会话', 'T3', 'zzz-不存在的关键词'];
    let rendered = 0;
    let matchedNonEmpty = 0;

    for (const keyword of keywords) {
      for (const filter of [keyword, keyword.toLowerCase()]) {
        const groups = buildSessionGroups({
          threads: manyThreads(12),
          archivedThreads: [makeThread({ id: 'z1', name: '归档的', updatedAt: 900 })],
          openTabs: [makeOpenTab('t3', '开着的')],
          pinnedIds: ['t2'],
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

  it('marks_sessions_present_in_running_set', () => {
    const groups = buildSessionGroups({
      threads: manyThreads(12),
      archivedThreads: [makeThread({ id: 'z1', name: '归档的', updatedAt: 900 })],
      openTabs: [makeOpenTab('t1', '开着的')],
      pinnedIds: ['t2'],
      runningIds: ['t1', 't12', 'z1'],
    });

    const running = rows(groups)
      .filter((session) => session.running)
      .map((session) => session.id)
      .sort();
    expect(running).toEqual(['t1', 't12', 'z1']);
    // running 必须是明确的布尔值，不能是 undefined 蒙混过去
    for (const session of rows(groups)) {
      expect(typeof session.running, `${session.id}.running`).toBe('boolean');
    }
  });
});
