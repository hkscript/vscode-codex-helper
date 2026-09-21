/**
 * Maps rollout files to the live codex app-server process holding them.
 *
 * Linux only (design D16): a running app-server keeps an open fd on the rollout
 * file of every thread it has loaded, so `/proc/<pid>/fd` answers "is anyone
 * still running this session?" without touching the protocol.
 *
 * Every syscall here races process teardown — `/proc` entries disappear
 * mid-scan. A failure on one entry must skip that entry, never abort the scan.
 */

export interface ProcessScanFs {
  readdirSync(path: string): string[];
  readlinkSync(path: string): string;
  readFileSync(path: string, encoding: 'utf8'): string;
}

export interface ScanHeldRolloutsOptions {
  fs: ProcessScanFs;
  procRoot?: string;
}

const ROLLOUT_UUID =
  /rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** `cmdline` is NUL-separated, so a substring test is enough to spot the subcommand. */
function isAppServer(cmdline: string): boolean {
  return cmdline.includes('codex') && cmdline.includes('app-server');
}

export function scanHeldRollouts(options: ScanHeldRolloutsOptions): Map<string, number> {
  const { fs } = options;
  const procRoot = options.procRoot ?? '/proc';
  const held = new Map<string, number>();

  let entries: string[];
  try {
    entries = fs.readdirSync(procRoot);
  } catch {
    return held;
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);

    try {
      if (!isAppServer(fs.readFileSync(`${procRoot}/${entry}/cmdline`, 'utf8'))) continue;
    } catch {
      continue;
    }

    let fds: string[];
    try {
      fds = fs.readdirSync(`${procRoot}/${entry}/fd`);
    } catch {
      continue;
    }

    for (const fd of fds) {
      let link: string;
      try {
        link = fs.readlinkSync(`${procRoot}/${entry}/fd/${fd}`);
      } catch {
        continue;
      }
      const uuid = link.match(ROLLOUT_UUID)?.[1];
      if (uuid) held.set(uuid.toLowerCase(), pid);
    }
  }

  return held;
}
