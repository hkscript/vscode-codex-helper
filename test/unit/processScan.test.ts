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
    readdirSync(path: string): string[] {
      if (path === '/proc') return [...Object.keys(processes), 'self', 'cpuinfo'];
      const pid = path.match(/^\/proc\/(\d+)\/fd$/)?.[1];
      const entry = pid ? processes[pid] : undefined;
      if (!entry) throw new Error(`ENOENT: ${path}`);
      return Object.keys(entry.fds);
    },
    readlinkSync(path: string): string {
      const m = path.match(/^\/proc\/(\d+)\/fd\/(.+)$/);
      const link = m ? processes[m[1]!]?.fds[m[2]!] : undefined;
      if (link === undefined) throw new Error(`ENOENT: ${path}`);
      return link;
    },
    readFileSync(path: string): string {
      const pid = path.match(/^\/proc\/(\d+)\/cmdline$/)?.[1];
      const entry = pid ? processes[pid] : undefined;
      if (!entry) throw new Error(`ENOENT: ${path}`);
      return entry.cmdline;
    },
  };
}

describe('processScan', () => {
  it('maps_rollout_file_to_holding_codex_process', () => {
    const fs = fakeProc({
      // cmdline 是 NUL 分隔的，同时含 codex 与 app-server 才算数
      '4242': {
        cmdline: '/usr/bin/codex\0app-server\0',
        fds: { '0': '/dev/null', '17': rollout(UUID_A) },
      },
    });

    const held = scanHeldRollouts({ fs });

    expect(held.get(UUID_A)).toBe(4242);
    expect(held.size).toBe(1);
  });

  it('ignores_rollout_fd_held_by_non_codex_process', () => {
    const fs = fakeProc({
      // 同一个 rollout 被 tail / 编辑器打开，不代表有 app-server 在跑这个会话
      '5150': { cmdline: '/usr/bin/tail\0-f\0', fds: { '3': rollout(UUID_A) } },
      // codex 但不是 app-server 子命令
      '5151': { cmdline: '/usr/bin/codex\0exec\0', fds: { '3': rollout(UUID_B) } },
      // 同一轮里真的有一个 app-server：没有它，下面三条否定断言对
      // 「永远返回空 Map」的实现同样成立，这条测试就不具备失败能力
      '5152': { cmdline: '/usr/bin/codex\0app-server\0', fds: { '3': rollout(UUID_C) } },
    });

    const held = scanHeldRollouts({ fs });

    expect(held.get(UUID_C)).toBe(5152);
    expect(held.has(UUID_A)).toBe(false);
    expect(held.has(UUID_B)).toBe(false);
    expect(held.size).toBe(1);
  });

  it('skips_processes_that_vanish_during_scan', () => {
    const base = fakeProc({
      '4242': { cmdline: '/usr/bin/codex\0app-server\0', fds: { '17': rollout(UUID_A) } },
      '4243': { cmdline: '/usr/bin/codex\0app-server\0', fds: { '18': rollout(UUID_B) } },
    });
    const fs: ProcessScanFs = {
      ...base,
      readdirSync(path: string): string[] {
        // 4243 在我们读它的 fd 目录时刚好退出了
        if (path === '/proc/4243/fd') throw new Error('ENOENT: /proc/4243/fd');
        return base.readdirSync(path);
      },
    };

    const held = scanHeldRollouts({ fs });

    // 正空间断言：一个进程消失不能让整轮扫描作废，活着的那个必须还在
    expect(held.get(UUID_A)).toBe(4242);
    expect(held.has(UUID_B)).toBe(false);
  });
});
