import { describe, expect, it } from 'vitest';
import {
  EFFORT_SETTING_OFF,
  EFFORT_SETTING_REMEMBER,
  effortToApply,
  lastUsedReasoningEffort,
  resolveNewSessionReasoningEffort,
} from '../../src/session/reasoningEffort';
import { makeThread } from '../helpers/fakes';

/**
 * 新建会话要写进配置的思考级别：来源是「会话列表里最近一次真正用过的级别」，
 * 判定规则全是纯函数，方便把边界（空值、扫描上限、显式覆盖）一条条钉住。
 */
describe('new session reasoning effort', () => {
  // REQ: 新建会话记忆思考级别 / Scenario: 取最近一次用过的级别
  it('picks_the_newest_thread_that_has_an_effort', () => {
    const threads = [
      makeThread({ id: 'newest', reasoningEffort: null, updatedAt: 30 }),
      makeThread({ id: 'second', reasoningEffort: 'high', updatedAt: 20 }),
      makeThread({ id: 'third', reasoningEffort: 'low', updatedAt: 10 }),
    ];

    expect(lastUsedReasoningEffort(threads)).toBe('high');
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 只扫最近一批会话
  it('stops_scanning_after_the_limit', () => {
    const threads = [
      ...Array.from({ length: 10 }, (_, index) =>
        makeThread({ id: `blank-${index}`, reasoningEffort: null, updatedAt: 100 - index }),
      ),
      makeThread({ id: 'older', reasoningEffort: 'low', updatedAt: 1 }),
    ];

    expect(lastUsedReasoningEffort(threads, 10)).toBeNull();
    expect(lastUsedReasoningEffort(threads, 11)).toBe('low');
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 没有任何历史级别时不动配置
  it('returns_null_when_no_thread_records_an_effort', () => {
    const threads = [
      makeThread({ id: 'a', reasoningEffort: null }),
      makeThread({ id: 'b' }),
      makeThread({ id: 'c', reasoningEffort: '   ' }),
    ];

    expect(lastUsedReasoningEffort(threads)).toBeNull();
  });

  // REQ: 新建会话记忆思考级别 / Scenario: off 完全不干预
  it('off_never_touches_the_session', () => {
    expect(effortToApply(EFFORT_SETTING_OFF, 'high')).toBeNull();
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 默认跟随上次用过的级别
  it('remember_writes_the_last_used_level', () => {
    expect(effortToApply(EFFORT_SETTING_REMEMBER, 'high')).toBe('high');
    // 没设过（undefined）等价于默认值 remember
    expect(effortToApply(undefined, 'low')).toBe('low');
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 没有历史级别时什么都不写
  it('remember_without_history_writes_nothing', () => {
    expect(effortToApply(EFFORT_SETTING_REMEMBER, null)).toBeNull();
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 显式级别压过历史级别
  it('an_explicit_level_wins_over_the_history', () => {
    expect(effortToApply('low', 'high')).toBe('low');
    expect(effortToApply('low', null)).toBe('low');
  });
});

/**
 * 串起来的那一步：读设置 → 学上次级别 → 给出「要写进新会话的级别」。
 * 它必须「怎么失败都不影响新建会话」，所以这里的每条用例都在钉「失败时的返回值与副作用」。
 */
describe('resolve new session reasoning effort', () => {
  function makeDeps(overrides: Partial<Parameters<typeof resolveNewSessionReasoningEffort>[0]> = {}) {
    const listed: number[] = [];
    const logs: string[] = [];
    const deps = {
      setting: EFFORT_SETTING_REMEMBER as string | undefined,
      listThreads: async () => {
        listed.push(1);
        return [makeThread({ id: 'used', reasoningEffort: 'high' })];
      },
      log: (message: string) => {
        logs.push(message);
      },
      ...overrides,
    };
    return { deps, listed, logs };
  }

  // REQ: 新建会话记忆思考级别 / Scenario: 默认沿用上次用过的级别
  it('returns_the_level_learned_from_the_thread_list', async () => {
    const { deps, listed } = makeDeps();

    await expect(resolveNewSessionReasoningEffort(deps)).resolves.toBe('high');

    expect(listed).toHaveLength(1);
  });

  // REQ: 新建会话记忆思考级别 / Scenario: off 时连列表都不读
  it('off_reads_nothing_at_all', async () => {
    const { deps, listed } = makeDeps({ setting: EFFORT_SETTING_OFF });

    await expect(resolveNewSessionReasoningEffort(deps)).resolves.toBeNull();

    expect(listed).toHaveLength(0);
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 显式配置了级别就不用去学
  it('an_explicit_setting_skips_the_thread_list', async () => {
    const { deps, listed } = makeDeps({ setting: 'low' });

    await expect(resolveNewSessionReasoningEffort(deps)).resolves.toBe('low');

    expect(listed).toHaveLength(0);
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 读列表失败不往外抛
  it('swallows_a_failed_thread_list', async () => {
    const listFailure = makeDeps({
      listThreads: async () => {
        throw new Error('app-server exploded');
      },
    });
    await expect(resolveNewSessionReasoningEffort(listFailure.deps)).resolves.toBeNull();
    expect(listFailure.logs.join(' ')).toContain('app-server exploded');
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 学不到级别就不带级别建会话
  it('returns_null_when_no_level_was_learned', async () => {
    const { deps } = makeDeps({
      listThreads: async () => [makeThread({ id: 'blank', reasoningEffort: null })],
    });

    await expect(resolveNewSessionReasoningEffort(deps)).resolves.toBeNull();
  });
});
