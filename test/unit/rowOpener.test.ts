import { describe, expect, it } from 'vitest';
import type { UriLike } from '../../src/codex/types';
import { createRowOpener } from '../../src/session/rowOpener';
import { createFakeUriApi } from '../helpers/fakes';

const uriApi = createFakeUriApi();
const codexUri = (path: string, query = ''): UriLike =>
  uriApi.file(path).with({ scheme: 'openai-codex', authority: 'route', query }) as UriLike;

interface Harness {
  calls: string[];
  open(node: unknown): Promise<boolean>;
  unarchiveCalls: string[];
}

function createHarness(
  overrides: {
    unarchive?: (id: string) => Promise<boolean>;
    /** 默认「没什么可重载的」：既有用例的行为不变（聚焦已有标签）。 */
    reloadUntitledTab?: (uri: UriLike) => Promise<boolean>;
  } = {},
): Harness {
  const calls: string[] = [];
  const unarchiveCalls: string[] = [];
  const open = createRowOpener({
    unarchive: async (id: string) => {
      calls.push(`unarchive:${id}`);
      unarchiveCalls.push(id);
      return overrides.unarchive ? overrides.unarchive(id) : true;
    },
    revealTab: async (uri: UriLike) => {
      calls.push(`revealTab:${uri.path}`);
      return true;
    },
    openSession: async (id: string) => {
      calls.push(`openSession:${id}`);
      return true;
    },
    reloadUntitledTab: async (uri: UriLike) => {
      calls.push(`reloadUntitledTab:${uri.path}`);
      return overrides.reloadUntitledTab ? overrides.reloadUntitledTab(uri) : false;
    },
  });
  return { calls, unarchiveCalls, open };
}

describe('rowOpener', () => {
  // REQ: 会话打开与聚焦 / Scenario: 打开已归档的会话会先取消归档
  it('archived_row_unarchives_before_opening', async () => {
    const harness = createHarness();
    await expect(harness.open({ sessionId: 't1', archived: true })).resolves.toBe(true);
    // 顺序有意义：反过来的话面板会先以归档态打开，再被刷新成非归档态
    expect(harness.calls).toEqual(['unarchive:t1', 'openSession:t1']);

    const withTab = createHarness();
    await withTab.open({ sessionId: 't1', archived: true, tabUri: codexUri('/local/t1') });
    // 标签行总是先问一次「标题过时了吗」，没过时才退到聚焦
    expect(withTab.calls).toEqual([
      'unarchive:t1',
      'reloadUntitledTab:/local/t1',
      'revealTab:/local/t1',
    ]);
  });

  // REQ: 会话打开与聚焦 / Scenario: 取消归档失败不阻止打开
  it('opens_even_when_unarchive_fails', async () => {
    const harness = createHarness({ unarchive: async () => false });

    await expect(harness.open({ sessionId: 't1', archived: true })).resolves.toBe(true);

    // 用户点的是「打开」：前置动作失败不该把打开动作一起吞掉
    expect(harness.calls).toEqual(['unarchive:t1', 'openSession:t1']);
  });

  // INV-005: 只有归档行在打开前取消归档（且失败不阻止打开）
  it('unarchive_only_for_archived_rows_before_opening', async () => {
    let checked = 0;
    let unarchiveRows = 0;
    let opened = 0;

    for (const archived of [false, true]) {
      for (const withTab of [false, true]) {
        for (const unarchiveOk of [false, true]) {
          const harness = createHarness({ unarchive: async () => unarchiveOk });
          const node = {
            sessionId: 't1',
            archived,
            tabUri: withTab ? codexUri('/local/t1') : null,
          };

          const label = `(archived=${archived}, tab=${withTab}, unarchiveOk=${unarchiveOk})`;
          await expect(harness.open(node), `${label} 返回已打开`).resolves.toBe(true);

          // 未归档行永远不得触发取消归档；归档行恰好一次
          expect(harness.unarchiveCalls, `${label} unarchive 次数`).toEqual(archived ? ['t1'] : []);

          // 无论取消归档成败，打开动作都要发生，且必须排在取消归档之后
          const openCall = withTab ? 'revealTab:/local/t1' : 'openSession:t1';
          expect(harness.calls.at(-1), `${label} 打开动作`).toBe(openCall);
          if (archived) {
            expect(harness.calls[0], `${label} 取消归档在前`).toBe('unarchive:t1');
          }

          unarchiveRows += Number(archived);
          opened += 1;
          checked += 1;
        }
      }
    }

    expect(checked).toBe(8);
    expect(unarchiveRows).toBe(4);
    expect(opened).toBe(8);
  });

  // REQ: 未标题标签的标题同步 / Scenario: 点击会话条目时把标题还停在 Codex 的标签重载一次
  it('reloads_untitled_tab_instead_of_revealing', async () => {
    const harness = createHarness({ reloadUntitledTab: async () => true });

    await expect(
      harness.open({ sessionId: 't1', tabUri: codexUri('/local/t1') }),
    ).resolves.toBe(true);

    // 重载成功就已经把那个标签打开了（重开后它就是激活标签），不该再聚焦一次
    expect(harness.calls).toEqual(['reloadUntitledTab:/local/t1']);
  });

  // REQ: 未标题标签的标题同步 / Scenario: 标题已经正确的标签只聚焦，不重载
  it('falls_back_to_reveal_when_there_is_nothing_to_reload', async () => {
    const harness = createHarness({ reloadUntitledTab: async () => false });

    await expect(
      harness.open({ sessionId: 't1', tabUri: codexUri('/local/t1') }),
    ).resolves.toBe(true);

    expect(harness.calls).toEqual(['reloadUntitledTab:/local/t1', 'revealTab:/local/t1']);
  });

  // REQ: 未标题标签的标题同步 / Scenario: 重载失败不能让标签打不开
  it('still_opens_when_reload_fails', async () => {
    // 关掉之后没打开成功（重载实现返回 false）时必须继续走打开路径，
    // 否则用户点一行会什么都没发生——甚至标签凭空消失
    const harness = createHarness({ reloadUntitledTab: async () => false });

    await harness.open({ sessionId: 't1', tabUri: codexUri('/local/t1') });

    expect(harness.calls.at(-1)).toBe('revealTab:/local/t1');
  });

  // REQ: 未标题标签的标题同步 / Scenario: 归档行先取消归档再重载
  it('archived_row_unarchives_before_reloading', async () => {
    const harness = createHarness({ reloadUntitledTab: async () => true });

    await harness.open({ sessionId: 't1', archived: true, tabUri: codexUri('/local/t1') });

    expect(harness.calls).toEqual(['unarchive:t1', 'reloadUntitledTab:/local/t1']);
  });

  // REQ: 未标题标签的标题同步 / Scenario: 没有已打开标签的会话不走重载
  it('does_not_reload_when_the_session_has_no_open_tab', async () => {
    const harness = createHarness({ reloadUntitledTab: async () => true });

    await harness.open({ sessionId: 't1' });

    expect(harness.calls).toEqual(['openSession:t1']);
  });
});
