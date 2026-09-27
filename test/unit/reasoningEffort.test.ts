import { describe, expect, it } from 'vitest';
import {
  EFFORT_SETTING_OFF,
  EFFORT_SETTING_REMEMBER,
  effortToWrite,
  lastUsedReasoningEffort,
  syncNewSessionReasoningEffort,
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
  it('off_never_touches_the_config', () => {
    expect(effortToWrite(EFFORT_SETTING_OFF, 'high')).toBeNull();
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 默认跟随上次用过的级别
  it('remember_writes_the_last_used_level', () => {
    expect(effortToWrite(EFFORT_SETTING_REMEMBER, 'high')).toBe('high');
    // 没设过（undefined）等价于默认值 remember
    expect(effortToWrite(undefined, 'low')).toBe('low');
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 没有历史级别时什么都不写
  it('remember_without_history_writes_nothing', () => {
    expect(effortToWrite(EFFORT_SETTING_REMEMBER, null)).toBeNull();
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 显式级别压过历史级别
  it('an_explicit_level_wins_over_the_history', () => {
    expect(effortToWrite('low', 'high')).toBe('low');
    expect(effortToWrite('low', null)).toBe('low');
  });
});

/**
 * 串起来的那一步：读设置 → 学上次级别 → 写配置。它必须「怎么失败都不影响新建会话」，
 * 所以这里的每条用例都在钉「失败时的返回值与副作用」。
 */
describe('sync new session reasoning effort', () => {
  function makeDeps(overrides: Partial<Parameters<typeof syncNewSessionReasoningEffort>[0]> = {}) {
    const listed: number[] = [];
    const written: string[] = [];
    const logs: string[] = [];
    const deps = {
      setting: EFFORT_SETTING_REMEMBER as string | undefined,
      listThreads: async () => {
        listed.push(1);
        return [makeThread({ id: 'used', reasoningEffort: 'high' })];
      },
      writeEffort: async (effort: string) => {
        written.push(effort);
        return true;
      },
      log: (message: string) => {
        logs.push(message);
      },
      ...overrides,
    };
    return { deps, listed, written, logs };
  }

  // REQ: 新建会话记忆思考级别 / Scenario: 默认把上次用过的级别写进配置
  it('writes_the_level_learned_from_the_thread_list', async () => {
    const { deps, listed, written } = makeDeps();

    await expect(syncNewSessionReasoningEffort(deps)).resolves.toBe('high');

    expect(listed).toHaveLength(1);
    expect(written).toEqual(['high']);
  });

  // REQ: 新建会话记忆思考级别 / Scenario: off 时连列表都不读
  it('off_reads_nothing_and_writes_nothing', async () => {
    const { deps, listed, written } = makeDeps({ setting: EFFORT_SETTING_OFF });

    await expect(syncNewSessionReasoningEffort(deps)).resolves.toBeNull();

    expect(listed).toHaveLength(0);
    expect(written).toHaveLength(0);
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 显式配置了级别就不用去学
  it('an_explicit_setting_skips_the_thread_list', async () => {
    const { deps, listed, written } = makeDeps({ setting: 'low' });

    await expect(syncNewSessionReasoningEffort(deps)).resolves.toBe('low');

    expect(listed).toHaveLength(0);
    expect(written).toEqual(['low']);
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 读列表或写配置失败都不往外抛
  it('swallows_failures_and_keeps_the_session_creatable', async () => {
    const listFailure = makeDeps({
      listThreads: async () => {
        throw new Error('app-server exploded');
      },
    });
    await expect(syncNewSessionReasoningEffort(listFailure.deps)).resolves.toBeNull();
    expect(listFailure.logs.join(' ')).toContain('app-server exploded');

    const writeFailure = makeDeps({
      writeEffort: async () => {
        throw new Error('config file is read-only');
      },
    });
    await expect(syncNewSessionReasoningEffort(writeFailure.deps)).resolves.toBeNull();
    expect(writeFailure.logs.join(' ')).toContain('config file is read-only');
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 学不到级别时不写配置
  it('writes_nothing_when_no_level_was_learned', async () => {
    const { deps, written } = makeDeps({
      listThreads: async () => [makeThread({ id: 'blank', reasoningEffort: null })],
    });

    await expect(syncNewSessionReasoningEffort(deps)).resolves.toBeNull();

    expect(written).toHaveLength(0);
  });
});
