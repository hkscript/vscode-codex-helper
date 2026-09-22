/**
 * Test doubles.
 *
 * Two roles live here on purpose:
 *  1. explicit fakes handed to the injected seams (uri api, memento, spawn, …);
 *  2. a stand-in for the `vscode` module itself — `vitest.config.ts` aliases
 *     `vscode` to this file so modules that legitimately import the editor API
 *     (treeProvider / commands / extension) can still be loaded in node.
 */
import { vi } from 'vitest';
import type { MementoLike, OpenTab, Thread, Turn, UriApi, UriLike, UriLikeWith } from '../../src/codex/types';

// ── Uri ────────────────────────────────────────────────────────────────────

function makeUri(uri: UriLike): UriLikeWith {
  const base: UriLike = { ...uri };
  return {
    ...base,
    with(change: Partial<UriLike>): UriLike {
      const next: UriLike = { ...base, ...change };
      return {
        ...next,
        with: (more: Partial<UriLike>) => ({ ...next, ...more, with: undefined } as unknown as UriLike),
        toString: () => `${next.scheme}://${next.authority}${next.path}`,
      } as unknown as UriLike;
    },
    toString: () => `${base.scheme}://${base.authority}${base.path}`,
  } as unknown as UriLikeWith;
}

export function createFakeUriApi(): UriApi {
  return {
    file: (path: string) => makeUri({ scheme: 'file', authority: '', path, query: '' }),
    parse: (value: string) => {
      const m = value.match(/^([a-z0-9+.-]+):\/\/([^/]*)(\/.*)?$/i);
      if (!m) return makeUri({ scheme: 'file', authority: '', path: value, query: '' });
      return makeUri({
        scheme: m[1] ?? 'file',
        authority: m[2] ?? '',
        path: m[3] ?? '',
        query: '',
      });
    },
  };
}

// ── Memento ────────────────────────────────────────────────────────────────

export interface FakeMemento extends MementoLike {
  store: Map<string, unknown>;
}

export function createFakeMemento(initial: Record<string, unknown> = {}): FakeMemento {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      store.set(key, value);
    },
  };
}

// ── child_process.spawn ────────────────────────────────────────────────────

type Listener = (...args: unknown[]) => void;

export interface FakeChildProcess {
  pid: number;
  killed: boolean;
  /** every chunk written to stdin, in order */
  written: string[];
  stdin: { write(chunk: string): boolean; end(): void };
  stdout: { on(event: string, cb: Listener): FakeChildProcess['stdout'] };
  stderr: { on(event: string, cb: Listener): FakeChildProcess['stderr'] };
  on(event: string, cb: Listener): FakeChildProcess;
  kill(signal?: string): boolean;
  /** push raw stdout text (chunk boundaries are under test control) */
  pushStdout(chunk: string): void;
  pushStderr(chunk: string): void;
  emit(event: string, ...args: unknown[]): void;
}

export function createFakeChildProcess(pid = 4242): FakeChildProcess {
  const stdoutListeners: Listener[] = [];
  const stderrListeners: Listener[] = [];
  const eventListeners = new Map<string, Listener[]>();
  const written: string[] = [];

  const child: FakeChildProcess = {
    pid,
    killed: false,
    written,
    stdin: {
      write(chunk: string) {
        written.push(chunk);
        return true;
      },
      end() {},
    },
    stdout: {
      on(event: string, cb: Listener) {
        if (event === 'data') stdoutListeners.push(cb);
        return child.stdout;
      },
    },
    stderr: {
      on(event: string, cb: Listener) {
        if (event === 'data') stderrListeners.push(cb);
        return child.stderr;
      },
    },
    on(event: string, cb: Listener) {
      const list = eventListeners.get(event) ?? [];
      list.push(cb);
      eventListeners.set(event, list);
      return child;
    },
    kill() {
      child.killed = true;
      child.emit('exit', 0, 'SIGTERM');
      return true;
    },
    pushStdout(chunk: string) {
      for (const listener of [...stdoutListeners]) listener(chunk);
    },
    pushStderr(chunk: string) {
      for (const listener of [...stderrListeners]) listener(chunk);
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of [...(eventListeners.get(event) ?? [])]) listener(...args);
    },
  };
  return child;
}

export interface FakeSpawn {
  spawn: (command: string, args: string[], options: unknown) => FakeChildProcess;
  calls: Array<{ command: string; args: string[]; options: unknown }>;
  children: FakeChildProcess[];
}

export function createFakeSpawn(): FakeSpawn {
  const calls: FakeSpawn['calls'] = [];
  const children: FakeChildProcess[] = [];
  const spawn = (command: string, args: string[], options: unknown): FakeChildProcess => {
    calls.push({ command, args, options });
    const child = createFakeChildProcess(4000 + children.length);
    children.push(child);
    return child;
  };
  return { spawn, calls, children };
}

/** Feed one JSON-RPC message to a fake child, as a single NDJSON line. */
export function pushMessage(child: FakeChildProcess, message: unknown): void {
  child.pushStdout(`${JSON.stringify(message)}\n`);
}

// ── domain fixtures ────────────────────────────────────────────────────────

export function makeThread(partial: Partial<Thread> & { id: string }): Thread {
  return {
    name: null,
    preview: `preview of ${partial.id}`,
    cwd: '/home/hk/github/vscode-codex-helper',
    createdAt: 1,
    updatedAt: 100,
    ...partial,
  };
}

/** 已绑定会话的 Codex 标签：resource 为 `/local/<id>`（query 为空）。 */
export function makeOpenTab(id: string, tabLabel = 'tab'): OpenTab {
  const uri = createFakeUriApi()
    .file(`/local/${id}`)
    .with({ scheme: 'openai-codex', authority: 'route', query: '' });
  return { id, tabLabel, uri };
}

export function makeTurn(partial: Partial<Turn> & { id: string }): Turn {
  return {
    status: 'completed',
    startedAt: 90,
    completedAt: 100,
    ...partial,
  };
}

// ── `vscode` module stand-in (see vitest.config.ts alias) ─────────────────

export class EventEmitter<T> {
  private readonly listeners: Array<(event: T) => unknown> = [];

  readonly event = (listener: (event: T) => unknown): { dispose(): void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) this.listeners.splice(index, 1);
      },
    };
  };

  fire(event: T): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  dispose(): void {
    this.listeners.length = 0;
  }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label: string;
  collapsibleState?: TreeItemCollapsibleState;
  id?: string;
  contextValue?: string;
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  command?: { command: string; title: string; arguments?: unknown[] };

  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class ThemeIcon {
  constructor(readonly id: string) {}
}

export const Uri = {
  file: (path: string): UriLikeWith => createFakeUriApi().file(path),
  parse: (value: string): UriLikeWith => createFakeUriApi().parse(value),
};

export const window = {
  showInputBox: vi.fn(async () => undefined as string | undefined),
  showErrorMessage: vi.fn(() => undefined),
  showInformationMessage: vi.fn(() => undefined),
  // 归档/删除都不弹确认框：这条 mock 存在只为了断言「从来没有被调用过」
  showWarningMessage: vi.fn(() => undefined),
  createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
  registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
  tabGroups: {
    all: [] as unknown[],
    activeTabGroup: { activeTab: undefined } as { activeTab: unknown },
    onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
    close: vi.fn(async () => true),
  },
};

export const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(async () => undefined),
};

export const extensions = {
  getExtension: vi.fn(() => undefined),
};

export const workspace = {
  getConfiguration: vi.fn(() => ({ get: () => undefined })),
  workspaceFolders: undefined as unknown,
};

export class TabInputCustom {
  constructor(readonly uri: UriLike, readonly viewType: string) {}
}

export default {
  EventEmitter,
  TreeItem,
  TreeItemCollapsibleState,
  ThemeIcon,
  Uri,
  window,
  commands,
  extensions,
  workspace,
  TabInputCustom,
};
