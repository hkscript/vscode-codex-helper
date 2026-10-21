import { describe, expect, it } from 'vitest';
import { scanHeldRollouts, type ProcessScanFs } from '../../src/session/processScan';

const UUID_A = '0199a6b2-1c3d-7e4f-8a9b-0c1d2e3f4a5b';
const UUID_B = '0199a6b2-1c3d-7e4f-8a9b-0c1d2e3f4a99';
const UUID_C = '0199a6b2-1c3d-7e4f-8a9b-0c1d2e3f4ac3';

const rollout = (uuid: string) =>
  `/home/hk/.codex/sessions/2026/09/21/rollout-2026-09-21T13-08-48-${uuid}.jsonl`;

/** A `/proc` snapshot: pid → { cmdline, fd links }. */
function fakeProc(
  processes: Record<string, { cmdline: string; fds: Record<string, string> }>,
): ProcessScanFs {
  return {
    async readdir(path: string): Promise<string[]> {
      if (path === '/proc') return [...Object.keys(processes), 'self', 'cpuinfo'];
      const pid = path.match(/^\/proc\/(\d+)\/fd$/)?.[1];
      const entry = pid ? processes[pid] : undefined;
      if (!entry) throw new Error(`ENOENT: ${path}`);
      return Object.keys(entry.fds);
    },
    async readlink(path: string): Promise<string> {
      const m = path.match(/^\/proc\/(\d+)\/fd\/(.+)$/);
      const link = m ? processes[m[1]!]?.fds[m[2]!] : undefined;
      if (link === undefined) throw new Error(`ENOENT: ${path}`);
      return link;
    },
    async readFile(path: string): Promise<string> {
      const pid = path.match(/^\/proc\/(\d+)\/cmdline$/)?.[1];
      const entry = pid ? processes[pid] : undefined;
      if (!entry) throw new Error(`ENOENT: ${path}`);
      return entry.cmdline;
    },
  };
}

const APP_SERVER = '/usr/bin/codex\0app-server\0';

describe('processScan', () => {
  it('maps_rollout_file_to_holding_codex_process', async () => {
    const fs = fakeProc({
      // cmdline 是 NUL 分隔的，同时含 codex 与 app-server 才算数
      '4242': {
        cmdline: '/usr/bin/codex\0app-server\0',
        fds: { '0': '/dev/null', '17': rollout(UUID_A) },
      },
    });

    const held = await scanHeldRollouts({ fs });

    expect(held.get(UUID_A)).toBe(4242);
    expect(held.size).toBe(1);
  });

  it('ignores_rollout_fd_held_by_non_codex_process', async () => {
    const fs = fakeProc({
      // 同一个 rollout 被 tail / 编辑器打开，不代表有 app-server 在跑这个会话
      '5150': { cmdline: '/usr/bin/tail\0-f\0', fds: { '3': rollout(UUID_A) } },
      // codex 但不是 app-server 子命令
      '5151': { cmdline: '/usr/bin/codex\0exec\0', fds: { '3': rollout(UUID_B) } },
      // 同一轮里真的有一个 app-server：没有它，下面三条否定断言对
      // 「永远返回空 Map」的实现同样成立，这条测试就不具备失败能力
      '5152': { cmdline: '/usr/bin/codex\0app-server\0', fds: { '3': rollout(UUID_C) } },
    });

    const held = await scanHeldRollouts({ fs });

    expect(held.get(UUID_C)).toBe(5152);
    expect(held.has(UUID_A)).toBe(false);
    expect(held.has(UUID_B)).toBe(false);
    expect(held.size).toBe(1);
  });

  it('skips_processes_that_vanish_during_scan', async () => {
    const base = fakeProc({
      '4242': { cmdline: '/usr/bin/codex\0app-server\0', fds: { '17': rollout(UUID_A) } },
      '4243': { cmdline: '/usr/bin/codex\0app-server\0', fds: { '18': rollout(UUID_B) } },
    });
    const fs: ProcessScanFs = {
      ...base,
      async readdir(path: string): Promise<string[]> {
        // 4243 在我们读它的 fd 目录时刚好退出了
        if (path === '/proc/4243/fd') throw new Error('ENOENT: /proc/4243/fd');
        return base.readdir(path);
      },
    };

    const held = await scanHeldRollouts({ fs });

    // 正空间断言：一个进程消失不能让整轮扫描作废，活着的那个必须还在
    expect(held.get(UUID_A)).toBe(4242);
    expect(held.has(UUID_B)).toBe(false);
  });
  it('skips_entries_whose_cmdline_or_fd_link_vanish_mid_scan', async () => {
    const base = fakeProc({
      '4242': {
        cmdline: APP_SERVER,
        fds: { '17': rollout(UUID_A), '18': rollout(UUID_B) },
      },
      '4243': { cmdline: APP_SERVER, fds: { '19': rollout(UUID_C) } },
    });
    const fs: ProcessScanFs = {
      ...base,
      // 4243 在我们读 cmdline 时退出；4242 的 fd 18 在列举之后、readlink 之前被关掉
      async readFile(path: string, encoding: 'utf8'): Promise<string> {
        if (path === '/proc/4243/cmdline') throw new Error('ENOENT: /proc/4243/cmdline');
        return base.readFile(path, encoding);
      },
      async readlink(path: string): Promise<string> {
        if (path === '/proc/4242/fd/18') throw new Error('ENOENT: /proc/4242/fd/18');
        return base.readlink(path);
      },
    };

    const held = await scanHeldRollouts({ fs });

    expect(held.get(UUID_A)).toBe(4242);
    expect(held.has(UUID_B)).toBe(false);
    expect(held.has(UUID_C)).toBe(false);
    expect(held.size).toBe(1);
  });

  it('returns_an_empty_map_when_proc_cannot_be_listed', async () => {
    const fs: ProcessScanFs = {
      ...fakeProc({}),
      readdir: async () => {
        throw new Error('EACCES: /proc');
      },
    };

    await expect(scanHeldRollouts({ fs })).resolves.toEqual(new Map());
  });

  it('merges_in_proc_order_regardless_of_completion_order', async () => {
    // 同一个 rollout 被两个 app-server 持有（例如 Codex 的和本插件的）：记下哪个 pid
    // 要和 /proc 的列举顺序一致，不能随读请求谁先回来而摇摆
    const base = fakeProc({
      '4242': { cmdline: APP_SERVER, fds: { '17': rollout(UUID_A) } },
      '4243': { cmdline: APP_SERVER, fds: { '17': rollout(UUID_A) } },
    });
    const fs: ProcessScanFs = {
      ...base,
      async readFile(path: string, encoding: 'utf8'): Promise<string> {
        // 先列举的那个进程的 cmdline 最后才读回来
        if (path === '/proc/4242/cmdline') await new Promise((resolve) => setTimeout(resolve, 5));
        return base.readFile(path, encoding);
      },
    };

    const held = await scanHeldRollouts({ fs });

    expect(held.get(UUID_A)).toBe(4243);
  });

  it('bounds_concurrent_reads', async () => {
    // 几百个进程的 cmdline 一次全排进 libuv 线程池，会挤占整个扩展宿主的文件操作
    const processes: Record<string, { cmdline: string; fds: Record<string, string> }> = {};
    for (let pid = 1000; pid < 1100; pid += 1) processes[String(pid)] = { cmdline: '/bin/sh\0', fds: {} };
    const base = fakeProc(processes);
    let active = 0;
    let peak = 0;
    const fs: ProcessScanFs = {
      ...base,
      async readFile(path: string, encoding: 'utf8'): Promise<string> {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        return base.readFile(path, encoding);
      },
    };

    await scanHeldRollouts({ fs });

    // 确实并发了（不是逐个串行），但有上限
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });
});
