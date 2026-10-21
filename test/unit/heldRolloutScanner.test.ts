import { describe, expect, it, vi } from 'vitest';
import { createHeldRolloutScanner } from '../../src/session/heldRolloutScanner';

const TTL = 1500;

/** 手动兑现的扫描：每次调用排一个待决项，测试决定它何时、以什么结果回来。 */
function controllableScan() {
  const pending: Array<{ resolve(held: Map<string, number>): void; reject(error: Error): void }> = [];
  const scan = vi.fn(
    () =>
      new Promise<Map<string, number>>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { scan, pending };
}

function makeScanner(scan: () => Promise<Map<string, number>>, platform: NodeJS.Platform = 'linux') {
  const clock = { ms: 1_000_000 };
  const scanner = createHeldRolloutScanner({ platform, scan, now: () => clock.ms, ttlMs: TTL });
  return { scanner, clock };
}

describe('heldRolloutScanner', () => {
  it('concurrent_callers_share_one_in_flight_scan', async () => {
    const { scan, pending } = controllableScan();
    const { scanner } = makeScanner(scan);

    const first = scanner.get();
    const second = scanner.get();
    await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(1);

    const held = new Map([['t1', 4242]]);
    pending[0]!.resolve(held);

    await expect(first).resolves.toBe(held);
    await expect(second).resolves.toBe(held);
  });

  it('reuses_a_result_within_the_ttl_and_rescans_after_it', async () => {
    const scan = vi.fn(async () => new Map([['t1', 4242]]));
    const { scanner, clock } = makeScanner(scan);

    const first = await scanner.get();
    clock.ms += TTL - 1;
    // 窗口内复用同一份结果，不再碰 /proc
    expect(await scanner.get()).toBe(first);
    expect(scan).toHaveBeenCalledTimes(1);

    clock.ms += 1;
    const third = await scanner.get();
    expect(scan).toHaveBeenCalledTimes(2);
    expect(third).not.toBe(first);
  });

  it('ttl_counts_from_when_the_scan_started', async () => {
    // 慢扫描回来时数据已经不新了：窗口从开始扫的那一刻算，不从拿到结果算
    const { scan, pending } = controllableScan();
    const { scanner, clock } = makeScanner(scan);

    const first = scanner.get();
    await Promise.resolve();
    clock.ms += TTL;
    pending[0]!.resolve(new Map());
    await first;

    void scanner.get();
    await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  // 归档预检的通路：一份 ttl 内的缓存也不能顶替「点击之后的 /proc」
  it('fresh_ignores_the_cache_and_refreshes_it_for_later_gets', async () => {
    let held = new Map<string, number>();
    const scan = vi.fn(async () => held);
    const { scanner, clock } = makeScanner(scan);

    expect(await scanner.get()).toEqual(new Map());

    held = new Map([['t1', 30157]]);
    clock.ms += 10;
    expect((await scanner.fresh())?.get('t1')).toBe(30157);
    expect(scan).toHaveBeenCalledTimes(2);

    // fresh 的结果写回缓存：紧跟着的 get 直接复用它
    expect((await scanner.get())?.get('t1')).toBe(30157);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('fresh_does_not_join_a_scan_that_started_earlier', async () => {
    const { scan, pending } = controllableScan();
    const { scanner, clock } = makeScanner(scan);

    const early = scanner.get();
    await Promise.resolve();
    clock.ms += 10;
    const late = scanner.fresh();
    await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(2);

    // 之后来的 get 合并到最新那轮上，而不是更早那轮
    const joined = scanner.get();
    await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(2);

    const fresher = new Map([['t1', 30157]]);
    pending[1]!.resolve(fresher);
    await expect(late).resolves.toBe(fresher);
    await expect(joined).resolves.toBe(fresher);

    // 更早那轮后回来：不能用旧结论盖掉缓存里更新的那份
    pending[0]!.resolve(new Map());
    await early;
    expect(await scanner.get()).toBe(fresher);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('a_failed_scan_is_neither_cached_nor_left_in_flight', async () => {
    const { scan, pending } = controllableScan();
    const { scanner } = makeScanner(scan);

    const failing = scanner.get();
    await Promise.resolve();
    pending[0]!.reject(new Error('EMFILE'));
    await expect(failing).rejects.toThrow('EMFILE');

    // 下一次调用重新扫，而不是拿到同一个失败
    const retry = scanner.get();
    await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(2);
    pending[1]!.resolve(new Map([['t1', 4242]]));
    await expect(retry).resolves.toEqual(new Map([['t1', 4242]]));
  });

  it('a_synchronously_throwing_scan_becomes_a_rejection', async () => {
    const scan = vi.fn((): Promise<Map<string, number>> => {
      throw new Error('EPERM');
    });
    const { scanner } = makeScanner(scan);

    await expect(scanner.get()).rejects.toThrow('EPERM');
    await expect(scanner.fresh()).rejects.toThrow('EPERM');
    expect(scan).toHaveBeenCalledTimes(2);
  });

  // D16：非 Linux 探测不了归属，返回 null 走时间阈值降级，也不碰 /proc
  it('returns_null_without_scanning_off_linux', async () => {
    const scan = vi.fn(async () => new Map<string, number>());
    const { scanner } = makeScanner(scan, 'darwin');

    await expect(scanner.get()).resolves.toBeNull();
    await expect(scanner.fresh()).resolves.toBeNull();
    expect(scan).not.toHaveBeenCalled();
  });
});
