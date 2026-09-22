import { describe, expect, it } from 'vitest';
import {
  CODEX_DEFAULT_TAB_TITLE,
  expectedTabTitle,
  planTabTitleSync,
  resourceKey,
} from '../../src/session/tabTitleSync';
import { makeOpenTab, makeThread } from '../helpers/fakes';

/** 生产里扫描出来的标签一定带句柄（关它只能靠它自己的句柄）；这里补上这个前提。 */
const untitledTab = (id: string) => ({
  ...makeOpenTab(id, CODEX_DEFAULT_TAB_TITLE),
  handle: { id: `handle-${id}` },
});

describe('tabTitleSync', () => {
  // REQ: 未标题标签的标题同步 / Scenario: 标签标题超过 30 字符时按上游规则截断
  it('expected_title_prefers_name_and_truncates_at_thirty', () => {
    expect(expectedTabTitle(makeThread({ id: 't1', name: '  修复登录超时  ' }))).toBe('修复登录超时');
    // 没有名字退回首条消息（上游：name?.trim() || preview）
    expect(expectedTabTitle(makeThread({ id: 't2', name: null, preview: '分析一下慢在哪' }))).toBe(
      '分析一下慢在哪',
    );
    expect(expectedTabTitle(makeThread({ id: 't3', name: null, preview: 'a'.repeat(30) }))).toBe(
      'a'.repeat(30),
    );
    expect(expectedTabTitle(makeThread({ id: 't4', name: null, preview: 'b'.repeat(31) }))).toBe(
      `${'b'.repeat(30)}…`,
    );
    // 全空白的名字要退到 preview，而不是当成名字用
    expect(expectedTabTitle(makeThread({ id: 't5', name: '   ', preview: 'fallback' }))).toBe(
      'fallback',
    );
  });

  it('expected_title_is_null_without_name_and_preview', () => {
    expect(expectedTabTitle(makeThread({ id: 't1', name: null, preview: '' }))).toBeNull();
    expect(expectedTabTitle(undefined)).toBeNull();
  });

  // REQ: 未标题标签的标题同步 / Scenario: 未标题标签被同步成会话标题
  it('plans_refresh_for_untitled_tab_of_a_titled_session', () => {
    const tab = untitledTab('t1');
    const plan = planTabTitleSync({
      tabs: [tab],
      threads: [makeThread({ id: 't1', name: '修复登录超时' })],
      runningIds: new Set(),
      activeTabKey: null,
      synced: new Map(),
    });

    expect(plan).toHaveLength(1);
    expect(plan[0]!.sessionId).toBe('t1');
    expect(plan[0]!.expectedTitle).toBe('修复登录超时');
    expect(resourceKey(plan[0]!.tab.uri)).toBe(resourceKey(tab.uri));
  });

  // REQ: 未标题标签的标题同步 / Scenario: 运行中的会话不自动同步
  it('skips_running_session', () => {
    const plan = planTabTitleSync({
      tabs: [makeOpenTab('t1', CODEX_DEFAULT_TAB_TITLE)],
      threads: [makeThread({ id: 't1', name: '修复登录超时' })],
      runningIds: new Set(['t1']),
      activeTabKey: null,
      synced: new Map(),
    });

    expect(plan).toEqual([]);
  });

  // REQ: 未标题标签的标题同步 / Scenario: 当前激活标签不自动同步
  it('skips_active_tab', () => {
    const tab = makeOpenTab('t1', CODEX_DEFAULT_TAB_TITLE);
    const plan = planTabTitleSync({
      tabs: [tab],
      threads: [makeThread({ id: 't1', name: '修复登录超时' })],
      runningIds: new Set(),
      activeTabKey: resourceKey(tab.uri),
      synced: new Map(),
    });

    expect(plan).toEqual([]);
  });

  it('skips_already_synced_target_title', () => {
    const plan = planTabTitleSync({
      tabs: [untitledTab('t1')],
      threads: [makeThread({ id: 't1', name: '修复登录超时' })],
      runningIds: new Set(),
      activeTabKey: null,
      synced: new Map([['t1', '修复登录超时']]),
    });

    expect(plan).toEqual([]);
    // 名字变了就是新的目标标题，仍然允许同步一次
    const again = planTabTitleSync({
      tabs: [untitledTab('t1')],
      threads: [makeThread({ id: 't1', name: '换了个名字' })],
      runningIds: new Set(),
      activeTabKey: null,
      synced: new Map([['t1', '修复登录超时']]),
    });
    expect(again).toHaveLength(1);
  });

  // REQ: 未标题标签的标题同步 / Scenario: 已有自定义标题的标签不被动
  it('skips_tab_that_already_has_a_custom_title', () => {
    const plan = planTabTitleSync({
      tabs: [makeOpenTab('t1', '修复登录超时')],
      threads: [makeThread({ id: 't1', name: '修复登录超时' })],
      runningIds: new Set(),
      activeTabKey: null,
      synced: new Map(),
    });

    expect(plan).toEqual([]);
  });

  it('skips_when_running_state_is_unknown', () => {
    const plan = planTabTitleSync({
      tabs: [makeOpenTab('t1', CODEX_DEFAULT_TAB_TITLE)],
      threads: [makeThread({ id: 't1', name: '修复登录超时' })],
      // 运行状态不可知（没开运行状态跟踪）时不赌：宁可不刷新
      runningIds: null,
      activeTabKey: null,
      synced: new Map(),
    });

    expect(plan).toEqual([]);
  });

  it('skips_sessions_that_are_not_in_the_list', () => {
    const plan = planTabTitleSync({
      tabs: [makeOpenTab('gone', CODEX_DEFAULT_TAB_TITLE)],
      threads: [makeThread({ id: 't1', name: '修复登录超时' })],
      runningIds: new Set(),
      activeTabKey: null,
      synced: new Map(),
    });

    expect(plan).toEqual([]);
  });
});
