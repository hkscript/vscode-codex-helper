import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEW_SESSION_MAX_WAIT_MS,
  DEFAULT_NEW_SESSION_POLL_MS,
  createNewSessionWatch,
} from '../../src/session/newSessionWatch';

interface Harness {
  refreshes: number;
  listCalls: number;
  /** 手动触发一次轮询（定时器已经被取消时什么都不做）。 */
  tick(): Promise<void>;
  scheduled: boolean;
  setListed(ids: string[]): void;
  setOpenTabs(ids: string[]): void;
  setNow(ms: number): void;
  setListFailure(fail: boolean): void;
  watch(id: string): void;
  stop(): void;
}

function createHarness(): Harness {
  let listed: string[] = [];
  let open = new Set<string>();
  let now = 0;
  let failList = false;
  let scheduledFn: (() => void) | undefined;
  const state = {
    refreshes: 0,
    listCalls: 0,
  };
  const watch = createNewSessionWatch({
    listThreadIds: async () => {
      state.listCalls += 1;
      if (failList) throw new Error('app-server 忙');
      return listed;
    },
    openTabIds: () => new Set(open),
    refresh: () => {
      state.refreshes += 1;
    },
    now: () => now,
    setInterval: (fn) => {
      scheduledFn = fn;
      return {
        cancel: () => {
          scheduledFn = undefined;
        },
      };
    },
  });
  return {
    get refreshes() {
      return state.refreshes;
    },
    get listCalls() {
      return state.listCalls;
    },
    get scheduled() {
      return scheduledFn !== undefined;
    },
    async tick() {
      await scheduledFn?.();
    },
    setListed(ids) {
      listed = ids;
    },
    setOpenTabs(ids) {
      open = new Set(ids);
    },
    setNow(ms) {
      now = ms;
    },
    setListFailure(fail) {
      failList = fail;
    },
    watch: (id) => watch.watch(id),
    stop: () => watch.stop(),
  };
}

describe('newSessionWatch', () => {
  it('uses_three_second_polling_with_a_ten_minute_cap', () => {
    // 这两个数就是「盯多久」的承诺：3 秒复查一次，最多等 10 分钟
    expect(DEFAULT_NEW_SESSION_POLL_MS).toBe(3_000);
    expect(DEFAULT_NEW_SESSION_MAX_WAIT_MS).toBe(10 * 60_000);
  });

  // REQ: 新建会话 / Scenario: 新会话进列表后自动刷新侧边栏
  it('refreshes_once_and_stops_when_the_session_appears', async () => {
    const harness = createHarness();
    harness.setOpenTabs(['t1']);
    harness.setListed([]);
    harness.watch('t1');

    await harness.tick();
    expect(harness.refreshes).toBe(0);
    expect(harness.listCalls).toBe(1);

    harness.setListed(['t1']);
    await harness.tick();
    expect(harness.refreshes).toBe(1);

    // 收敛之后必须停表：不然每 3 秒白拉一次列表
    expect(harness.scheduled).toBe(false);
    await harness.tick();
    expect(harness.listCalls).toBe(2);
  });

  // REQ: 新建会话 / Scenario: 用户建完就关了标签 → 不再等
  it('stops_when_the_tab_was_closed', async () => {
    const harness = createHarness();
    harness.setOpenTabs(['t1']);
    harness.watch('t1');

    harness.setOpenTabs([]); // 标签被关掉
    await harness.tick();

    expect(harness.listCalls).toBe(0);
    expect(harness.scheduled).toBe(false);
  });

  // REQ: 新建会话 / Scenario: 一直没聊 → 等满上限就放弃
  it('gives_up_after_the_wait_cap', async () => {
    const harness = createHarness();
    harness.setOpenTabs(['t1']);
    harness.watch('t1');

    harness.setNow(DEFAULT_NEW_SESSION_MAX_WAIT_MS + 1);
    await harness.tick();

    expect(harness.listCalls).toBe(0);
    expect(harness.scheduled).toBe(false);
  });

  it('keeps_polling_when_the_list_call_fails', async () => {
    const harness = createHarness();
    harness.setOpenTabs(['t1']);
    harness.watch('t1');

    harness.setListFailure(true);
    await harness.tick();
    expect(harness.refreshes).toBe(0);
    expect(harness.scheduled).toBe(true);

    harness.setListFailure(false);
    harness.setListed(['t1']);
    await harness.tick();
    expect(harness.refreshes).toBe(1);
  });

  // REQ: 新建会话 / Scenario: 连着建两个会话时两个都要等
  it('waits_for_every_pending_session', async () => {
    const harness = createHarness();
    harness.setOpenTabs(['t1', 't2']);
    harness.watch('t1');
    harness.watch('t2');

    harness.setListed(['t1']);
    await harness.tick();
    expect(harness.refreshes).toBe(1);
    // 还有一个没出现 ⇒ 继续等
    expect(harness.scheduled).toBe(true);

    harness.setListed(['t1', 't2']);
    await harness.tick();
    expect(harness.refreshes).toBe(2);
    expect(harness.scheduled).toBe(false);
  });
});
