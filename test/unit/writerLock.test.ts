import { describe, expect, it, vi } from 'vitest';
import { createWriterLockProbe } from '../../src/session/writerLock';

describe('writerLock', () => {
  function makeDeps(held: Map<string, number> | null, ownPid: number | undefined) {
    const scanHeldRollouts = vi.fn(() => held);
    const probe = createWriterLockProbe({ scanHeldRollouts, ownPid: () => ownPid });
    return { probe, scanHeldRollouts };
  }

  // REQ: 会话归档与删除 / Scenario: 会话被 Codex 那侧的进程持有时预检命中
  it('reports_a_thread_held_by_another_process', async () => {
    const { probe } = makeDeps(new Map([['t1', 30157]]), 4242);

    await expect(probe('t1')).resolves.toBe(true);
  });

  // 自己持有不算冲突：同进程归档不会撞写者锁
  it('ignores_a_thread_held_by_our_own_app_server', async () => {
    const { probe } = makeDeps(new Map([['t1', 4242]]), 4242);

    await expect(probe('t1')).resolves.toBe(false);
  });

  it('ignores_threads_nobody_holds', async () => {
    const { probe } = makeDeps(new Map([['t2', 30157]]), 4242);

    await expect(probe('t1')).resolves.toBe(false);
  });

  // 自己的 pid 未知 ⇒ 我们连 app-server 都没起，持有者不可能是我们
  it('treats_an_unknown_own_pid_as_another_process', async () => {
    const { probe } = makeDeps(new Map([['t1', 30157]]), undefined);

    await expect(probe('t1')).resolves.toBe(true);
  });

  // 平台不支持探测（macOS / Windows）时放行：不预检，让请求自己去撞，失败有兜底说明
  it('passes_when_ownership_cannot_be_detected', async () => {
    const { probe } = makeDeps(null, 4242);

    await expect(probe('t1')).resolves.toBe(false);
  });

  // 探测本身失败（/proc 读不到）时不猜，放行
  it('passes_when_the_scan_throws', async () => {
    const probe = createWriterLockProbe({
      scanHeldRollouts: () => {
        throw new Error('EPERM: /proc');
      },
      ownPid: () => 4242,
    });

    await expect(probe('t1')).resolves.toBe(false);
  });
});
