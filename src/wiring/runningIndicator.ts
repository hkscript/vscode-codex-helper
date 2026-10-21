import { watch } from 'node:fs';
import { readFile, readdir, readlink } from 'node:fs/promises';
import type * as vscode from 'vscode';
import type { Turn } from '../codex/types';
import { createHeldRolloutScanner, type HeldRolloutScanner } from '../session/heldRolloutScanner';
import { scanHeldRollouts } from '../session/processScan';
import { createRunningTracker, type RunningTracker } from '../session/runningTracker';
import type { SessionWebviewProvider } from '../ui/sessionWebviewProvider';

/**
 * 运行状态判定与归档预检共用这一个 /proc 扫描器：同时到来的调用合并成一轮，结果短时缓存。
 * 归属探测只在 Linux 可用；其他平台返回 null 走时间阈值降级（D16）。
 */
export function createRolloutScanner(): HeldRolloutScanner {
  return createHeldRolloutScanner({
    platform: process.platform,
    scan: () => scanHeldRollouts({ fs: { readdir, readlink, readFile } }),
  });
}

export interface RunningTrackerWiringDeps {
  configuration(): vscode.WorkspaceConfiguration;
  scanner: HeldRolloutScanner;
  listTurns(threadId: string): Promise<Turn | undefined>;
  view: Pick<
    SessionWebviewProvider,
    'setRunning' | 'isVisible' | 'onDidChangeVisibility'
  >;
  subscriptions: Array<{ dispose(): unknown }>;
}

/** `showRunningIndicator` 关掉时不建 tracker，返回 undefined。 */
export function wireRunningTracker(deps: RunningTrackerWiringDeps): RunningTracker | undefined {
  if (!(deps.configuration().get<boolean>('showRunningIndicator') ?? true)) return undefined;
  const tracker = createRunningTracker({
    scanHeldRollouts: ({ fresh }) => (fresh ? deps.scanner.fresh() : deps.scanner.get()),
    listTurns: deps.listTurns,
    watch: (path: string, onChange: () => void) => {
      const watcher = watch(path, onChange);
      return { close: () => watcher.close() };
    },
    onChange: (ids) => deps.view.setRunning(ids),
    pollSeconds: deps.configuration().get<number>('runningPollSeconds') ?? 5,
    staleSeconds: deps.configuration().get<number>('runningStaleSeconds') ?? 300,
  });
  // 运行状态只在侧边栏里展示：视图不可见（含还没打开过）时不重算，重新可见时补算
  tracker.setActive(deps.view.isVisible());
  deps.subscriptions.push(deps.view.onDidChangeVisibility((visible) => tracker.setActive(visible)));
  return tracker;
}
