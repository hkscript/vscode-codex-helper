import { mapWithLimit } from './mapWithLimit';

/**
 * Maps rollout files to the live codex app-server process holding them.
 *
 * Linux only (design D16): a running app-server keeps an open fd on the rollout
 * file of every thread it has loaded, so `/proc/<pid>/fd` answers "is anyone
 * still running this session?" without touching the protocol.
 *
 * Every syscall here races process teardown — `/proc` entries disappear
 * mid-scan. A failure on one entry must skip that entry, never abort the scan.
 *
 * 全程异步：扫描跑在扩展宿主上，同步遍历每个进程的 cmdline 和 fd 目录会把宿主卡住。
 */

export interface ProcessScanFs {
  readdir(path: string): Promise<string[]>;
  readlink(path: string): Promise<string>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
}

export interface ScanHeldRolloutsOptions {
  fs: ProcessScanFs;
  procRoot?: string;
}

const ROLLOUT_UUID =
  /rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/**
 * 异步 fs 走 libuv 线程池，而线程池是整个扩展宿主共用的：一次把几百个读请求全排进去，
 * 别的扩展的文件操作就得排在后面等。限住并发，单轮扫描慢一点也不挤占别人。
 */
const SCAN_CONCURRENCY = 8;

/** `cmdline` is NUL-separated, so a substring test is enough to spot the subcommand. */
function isAppServer(cmdline: string): boolean {
  return cmdline.includes('codex') && cmdline.includes('app-server');
}

export async function scanHeldRollouts(
  options: ScanHeldRolloutsOptions,
): Promise<Map<string, number>> {
  const { fs } = options;
  const procRoot = options.procRoot ?? '/proc';
  const held = new Map<string, number>();

  let entries: string[];
  try {
    entries = await fs.readdir(procRoot);
  } catch {
    return held;
  }
  const pids = entries.filter((entry) => /^\d+$/.test(entry));

  const appServer: boolean[] = [];
  await mapWithLimit(pids, SCAN_CONCURRENCY, async (pid, index) => {
    try {
      appServer[index] = isAppServer(await fs.readFile(`${procRoot}/${pid}/cmdline`, 'utf8'));
    } catch {
      // 进程刚好退出：跳过
    }
  });

  // 结果按 /proc 的列举顺序合并，不随读请求的完成先后变化：同一个 rollout 被两个
  // app-server 持有时，记下的 pid 和同步实现一样是列举顺序里靠后的那个。
  for (const [index, entry] of pids.entries()) {
    if (!appServer[index]) continue;

    let fds: string[];
    try {
      fds = await fs.readdir(`${procRoot}/${entry}/fd`);
    } catch {
      continue;
    }

    const links: Array<string | undefined> = [];
    await mapWithLimit(fds, SCAN_CONCURRENCY, async (fd, fdIndex) => {
      try {
        links[fdIndex] = await fs.readlink(`${procRoot}/${entry}/fd/${fd}`);
      } catch {
        // fd 在列举之后被关掉：跳过
      }
    });

    const pid = Number(entry);
    for (const link of links) {
      const uuid = link?.match(ROLLOUT_UUID)?.[1];
      if (uuid) held.set(uuid.toLowerCase(), pid);
    }
  }

  return held;
}
