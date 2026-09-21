import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, readlinkSync, watch } from 'node:fs';
import * as vscode from 'vscode';
import { createAppServerClient, type AppServerClient } from './codex/appServerClient';
import { resolveCodexBinary } from './codex/binary';
import { createThreadApi } from './codex/threadApi';
import type { SessionGroup, Thread } from './codex/types';
import { createNewSessionCommand, createRenameSessionCommand, registerCommands } from './commands';
import { createSessionOpener } from './session/opener';
import { scanCodexTabs } from './session/openTabs';
import { createPinStore } from './session/pinStore';
import { scanHeldRollouts } from './session/processScan';
import { createRunningTracker, type RunningTracker } from './session/runningTracker';
import { buildSessionGroups } from './session/sessionStore';
import { createSessionTreeProvider } from './ui/treeProvider';

let appServer: AppServerClient | undefined;
let autoRefresh: ReturnType<typeof setInterval> | undefined;
let runningTracker: RunningTracker | undefined;

/** Menu contributions hand us the tree node; `TreeItem.command` hands us a payload. Accept both. */
function sessionIdOf(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const candidate = node as { sessionId?: string; session?: { id?: string } };
  return candidate.sessionId ?? candidate.session?.id;
}

function labelOf(node: unknown): string {
  const candidate = node as { label?: unknown; session?: { label?: string } };
  const label = candidate?.session?.label ?? candidate?.label;
  return typeof label === 'string' ? label : '';
}

export function activate(context: vscode.ExtensionContext): void {
  const pinStore = createPinStore(context.globalState);
  let filter: string | null = null;
  let threads: Thread[] = [];
  let cursor: string | null = null;

  const configuration = () => vscode.workspace.getConfiguration('codexHelper');

  /** Lazy: the 250 MB binary is only spawned when data is actually needed (D3). */
  function client(): AppServerClient {
    if (!appServer) {
      const binaryPath = resolveCodexBinary({
        getConfiguration: (section: string) => vscode.workspace.getConfiguration(section),
        getExtension: (id: string) => {
          const extension = vscode.extensions.getExtension(id);
          return extension ? { extensionPath: extension.extensionPath } : undefined;
        },
      });
      appServer = createAppServerClient({
        binaryPath,
        spawn: ((command: string, args: string[], options: object) =>
          spawn(command, args, options)) as never,
        onStderrLine: (line: string) => console.log(`[codex app-server] ${line}`),
      });
    }
    return appServer;
  }

  function api() {
    return createThreadApi(client(), {
      pageSize: configuration().get<number>('pageSize') ?? 50,
    });
  }

  function workspaceCwd(): string | null {
    if (!configuration().get<boolean>('filterByWorkspaceCwd')) return null;
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  function openTabs() {
    return scanCodexTabs(
      {
        all: vscode.window.tabGroups.all.map((group) => ({
          tabs: group.tabs.map((tab) => ({ label: tab.label, input: tab.input })),
        })),
      },
      { isCustomInput: (input: unknown) => input instanceof vscode.TabInputCustom },
    );
  }

  let tracker: RunningTracker | undefined;

  async function load(): Promise<SessionGroup[]> {
    const page = await api().listThreads({
      searchTerm: filter,
      cwd: workspaceCwd(),
      cursor: null,
    });
    threads = page.data;
    cursor = page.nextCursor;
    // 喂最新的线程列表。tracker 只在运行集合真的变化时才回调（D23），
    // 所以这条 refresh → load → update → refresh 的回环一轮就收敛。
    tracker?.update(threads);
    return buildSessionGroups({
      threads,
      openTabs: openTabs(),
      pinnedIds: pinStore.list(),
      runningIds: tracker?.snapshot() ?? null,
      filter,
    });
  }

  const provider = createSessionTreeProvider({ load });

  if (configuration().get<boolean>('showRunningIndicator') ?? true) {
    tracker = createRunningTracker({
      // 归属探测只在 Linux 可用；其他平台返回 null 走时间阈值降级（D16）。
      scanHeldRollouts: () =>
        process.platform === 'linux'
          ? scanHeldRollouts({ fs: { readdirSync, readlinkSync, readFileSync } })
          : null,
      listTurns: (threadId: string) => api().listTurns(threadId),
      watch: (path: string, onChange: () => void) => {
        const watcher = watch(path, onChange);
        return { close: () => watcher.close() };
      },
      onChange: () => provider.refresh(),
      pollSeconds: configuration().get<number>('runningPollSeconds') ?? 5,
      staleSeconds: configuration().get<number>('runningStaleSeconds') ?? 300,
    });
    runningTracker = tracker;
  }
  const view = vscode.window.createTreeView('codexHelper.sessions', {
    treeDataProvider: provider as unknown as vscode.TreeDataProvider<unknown>,
  });

  const opener = createSessionOpener({
    executeCommand: (command: string, ...args: unknown[]) =>
      Promise.resolve(vscode.commands.executeCommand(command, ...args)),
    showErrorMessage: (message: string) => vscode.window.showErrorMessage(message),
    uriApi: vscode.Uri,
  });

  const renameSession = createRenameSessionCommand({
    threadApi: { setThreadName: (threadId: string, name: string) => api().setThreadName(threadId, name) },
    showInputBox: (options) => Promise.resolve(vscode.window.showInputBox(options)),
    showErrorMessage: (message: string) => vscode.window.showErrorMessage(message),
  });

  const newSession = createNewSessionCommand({
    executeCommand: (command: string, ...args: unknown[]) =>
      Promise.resolve(vscode.commands.executeCommand(command, ...args)),
    showErrorMessage: (message: string) => vscode.window.showErrorMessage(message),
    uriApi: vscode.Uri,
    createNonce: () => randomUUID(),
  });

  context.subscriptions.push(
    view,
    ...registerCommands({
      refresh: () => provider.refresh(),
      openSession: async (node) => {
        const id = sessionIdOf(node);
        if (id) await opener.openSession(id);
      },
      renameSession: (node) => {
        const sessionId = sessionIdOf(node);
        return sessionId ? renameSession({ sessionId, label: labelOf(node) }) : undefined;
      },
      newSession,
      pinSession: async (node) => {
        const id = sessionIdOf(node);
        if (!id) return;
        await pinStore.pin(id);
        provider.refresh();
      },
      unpinSession: async (node) => {
        const id = sessionIdOf(node);
        if (!id) return;
        await pinStore.unpin(id);
        provider.refresh();
      },
      setFilter: async () => {
        const answer = await vscode.window.showInputBox({
          prompt: '按会话名或会话 id 过滤',
          value: filter ?? '',
        });
        if (answer === undefined) return;
        filter = answer.trim().length > 0 ? answer.trim() : null;
        provider.refresh();
      },
      clearFilter: () => {
        filter = null;
        provider.refresh();
      },
      loadMore: async () => {
        if (!cursor) return;
        const page = await api().listThreads({
          searchTerm: filter,
          cwd: workspaceCwd(),
          cursor,
        });
        threads = [...threads, ...page.data];
        cursor = page.nextCursor;
        provider.refresh();
      },
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => provider.refresh()),
  );

  const seconds = configuration().get<number>('autoRefreshSeconds') ?? 0;
  if (seconds > 0) {
    autoRefresh = setInterval(() => provider.refresh(), seconds * 1000);
  }
}

/** The app-server child process must not outlive the extension host (D3). */
export function deactivate(): void {
  if (autoRefresh) clearInterval(autoRefresh);
  autoRefresh = undefined;
  // inotify 句柄与轮询定时器不回收会比扩展活得更久。
  runningTracker?.dispose();
  runningTracker = undefined;
  appServer?.dispose();
  appServer = undefined;
}
