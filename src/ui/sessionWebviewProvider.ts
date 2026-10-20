import { randomUUID } from 'node:crypto';
import type * as vscode from 'vscode';
import type {
  OpenTab,
  SessionGroup,
  SessionItem,
  Thread,
  UriLike,
} from '../codex/types';
import { buildSessionGroups } from '../session/sessionStore';
import type { SessionPreview } from '../session/sessionPreview';
import { sessionWebviewHtml } from './sessionWebviewHtml';
import {
  activeSessionCount,
  collectCwdOptions,
  formatRelativeTime,
  type CwdOption,
} from './sessionViewModel';

/**
 * Raw data used to render the sidebar. The provider owns the view-only state
 * (search text, directory filter, expanded groups); the extension owns the
 * sources and hands over a snapshot on every refresh.
 */
export interface SessionSnapshot {
  threads: Thread[];
  archivedThreads: Thread[];
  openTabs: OpenTab[];
  pinnedIds: string[];
  runningIds: Iterable<string> | null;
  hasMore: boolean;
  archivedHasMore: boolean;
}

export interface SessionOpenRequest {
  sessionId: string;
  label: string;
  tabUri: UriLike | null;
  archived: boolean;
}

export interface SessionWebviewDeps {
  /** 上次在这个 workspace 里勾选的目录。 */
  initialCwdFilter?: string[];
  /** 目录选择变化时写回 workspaceState（失败不影响界面）。 */
  saveCwdFilter?(cwdFilter: string[]): Promise<void> | void;
  /** Fetch a fresh first page from the app-server. Throws when loading fails. */
  fetch(): Promise<void>;
  /** 过滤生效时把未加载的分页全部拉完。 */
  loadAll(): Promise<void>;
  /** 悬停预览：前两次 + 最后一次用户输入，以及模型最后回复。 */
  loadPreview(threadId: string): Promise<SessionPreview>;
  snapshot(): SessionSnapshot;
  loadMore(archived: boolean): Promise<void> | void;
  openSession(request: SessionOpenRequest): Promise<void> | void;
  newSession(): Promise<void> | void;
  renameSession(sessionId: string, label: string): Promise<void> | void;
  pinSession(sessionId: string): Promise<void> | void;
  unpinSession(sessionId: string): Promise<void> | void;
  archiveSession(sessionId: string): Promise<void> | void;
  unarchiveSession(sessionId: string): Promise<void> | void;
  deleteSession(sessionId: string): Promise<void> | void;
  now?(): number;
}

export interface SessionWebviewProvider {
  resolveWebviewView(view: vscode.WebviewView): void;
  /** Re-render from the current snapshot without touching the app-server. */
  refresh(): void;
  /** Fetch fresh session data, then re-render. */
  reload(): Promise<void>;
  setFilter(value: string): void;
  clearFilters(): void;
  focusSearch(): void;
  onDidChange(listener: () => void): { dispose(): void };
  dispose(): void;
}

interface SessionRow extends Omit<SessionItem, 'tabUri'> {
  time: string;
}

interface RenderGroup {
  id: string;
  label: string;
  sessions: SessionRow[];
}

interface RenderPayload {
  type: 'render';
  groups: RenderGroup[];
  cwds: CwdOption[];
  filter: string;
  cwdFilter: string[];
  expanded: Record<string, boolean>;
  activeCount: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  archivedHasMore: boolean;
  loadingAll: boolean;
}

/** `history` and `archived` start collapsed; the two active groups stay open. */
function defaultExpanded(groupId: string): boolean {
  return groupId !== 'history' && groupId !== 'archived';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function createSessionWebviewProvider(
  deps: SessionWebviewDeps,
): SessionWebviewProvider {
  const now = deps.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  const expanded = new Map<string, boolean>();
  const messageCache = new Map<string, { updatedAt: number | null; preview: SessionPreview }>();
  let view: vscode.WebviewView | undefined;
  let filter = '';
  let cwdFilter: string[] = [...(deps.initialCwdFilter ?? [])];
  let loading = false;
  let loadingAll: Promise<void> | null = null;
  let error: string | null = null;
  let loadedOnce = false;
  let disposed = false;

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function isExpanded(groupId: string): boolean {
    return expanded.get(groupId) ?? defaultExpanded(groupId);
  }

  function changeCwdFilter(next: string[]): void {
    cwdFilter = next;
    try {
      void Promise.resolve(deps.saveCwdFilter?.([...cwdFilter])).catch(() => undefined);
    } catch {
      // workspaceState 写失败只是记不住选择，不能影响过滤本身
    }
    render();
    ensureAllLoaded();
  }

  function hasActiveFilter(): boolean {
    return filter.trim().length > 0 || cwdFilter.length > 0;
  }

  function ensureAllLoaded(): void {
    if (!hasActiveFilter() || loadingAll) return;
    const snapshot = deps.snapshot();
    if (!snapshot.hasMore && !snapshot.archivedHasMore) return;
    loadingAll = Promise.resolve(deps.loadAll())
      .catch((error) => {
        console.log(`[codex-helper] 加载全部会话失败：${String(error)}`);
      })
      .finally(() => {
        loadingAll = null;
        refresh();
      });
    render();
  }

  function payload(): RenderPayload {
    const snapshot = deps.snapshot();
    const groups: SessionGroup[] = buildSessionGroups({
      threads: snapshot.threads,
      archivedThreads: snapshot.archivedThreads,
      openTabs: snapshot.openTabs,
      pinnedIds: snapshot.pinnedIds,
      runningIds: snapshot.runningIds,
      filter,
      cwdFilter,
    });
    const stamp = now();
    return {
      type: 'render',
      groups: groups.map((group) => ({
        id: group.id,
        label: group.label,
        sessions: group.sessions.map((session) => {
          // tabUri 留在扩展宿主：webview 只需要知道“是否已打开”，回传时按 id 现查真正的 Uri
          const { tabUri: _tabUri, ...rest } = session;
          return {
            ...rest,
            time: formatRelativeTime(session.updatedAt, stamp),
          };
        }),
      })),
      cwds: collectCwdOptions(snapshot.threads, snapshot.archivedThreads),
      filter,
      cwdFilter,
      expanded: Object.fromEntries(groups.map((group) => [group.id, isExpanded(group.id)])),
      activeCount: activeSessionCount(groups),
      loading,
      error,
      hasMore: snapshot.hasMore,
      archivedHasMore: snapshot.archivedHasMore,
      loadingAll: loadingAll !== null,
    };
  }

  function post(message: unknown): void {
    if (!view) return;
    void view.webview.postMessage(message);
  }

  function render(): void {
    if (view) post(payload());
  }

  function refresh(): void {
    if (disposed) return;
    render();
    notify();
  }

  async function reload(): Promise<void> {
    if (disposed) return;
    loading = true;
    render();
    try {
      await deps.fetch();
      error = null;
      loadedOnce = true;
      ensureAllLoaded();
    } catch (caught) {
      error = errorMessage(caught);
    } finally {
      loading = false;
      refresh();
    }
  }

  function postTimes(): void {
    if (!view) return;
    const snapshot = deps.snapshot();
    const groups = buildSessionGroups({
      threads: snapshot.threads,
      archivedThreads: snapshot.archivedThreads,
      openTabs: snapshot.openTabs,
      pinnedIds: snapshot.pinnedIds,
      runningIds: snapshot.runningIds,
      filter,
      cwdFilter,
    });
    const stamp = now();
    const times: Record<string, string> = {};
    for (const group of groups) {
      for (const session of group.sessions) {
        times[session.id] = formatRelativeTime(session.updatedAt, stamp);
      }
    }
    post({ type: 'times', times });
  }

  function sessionFromMessage(raw: unknown): SessionOpenRequest | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as {
      sessionId?: unknown;
      label?: unknown;
      tabUri?: unknown;
      archived?: unknown;
    };
    if (!isSessionId(candidate.sessionId)) return null;
    const tabUri =
      candidate.tabUri && typeof candidate.tabUri === 'object'
        ? (candidate.tabUri as UriLike)
        : null;
    return {
      sessionId: candidate.sessionId,
      label: typeof candidate.label === 'string' ? candidate.label : '',
      tabUri,
      archived: candidate.archived === true,
    };
  }

  async function handleAction(action: unknown, rawSession: unknown): Promise<void> {
    if (!rawSession || typeof rawSession !== 'object') return;
    const candidate = rawSession as { sessionId?: unknown; label?: unknown };
    if (!isSessionId(candidate.sessionId)) return;
    const sessionId = candidate.sessionId;
    const label = typeof candidate.label === 'string' ? candidate.label : '';
    switch (action) {
      case 'rename':
        await deps.renameSession(sessionId, label);
        break;
      case 'pin':
        await deps.pinSession(sessionId);
        break;
      case 'unpin':
        await deps.unpinSession(sessionId);
        break;
      case 'archive':
        await deps.archiveSession(sessionId);
        break;
      case 'unarchive':
        await deps.unarchiveSession(sessionId);
        break;
      case 'delete':
        await deps.deleteSession(sessionId);
        messageCache.delete(sessionId);
        break;
    }
  }

  async function handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const incoming = message as {
      type?: unknown;
      value?: unknown;
      cwd?: unknown;
      id?: unknown;
      expanded?: unknown;
      session?: unknown;
      action?: unknown;
      archived?: unknown;
      sessionId?: unknown;
      updatedAt?: unknown;
      requestId?: unknown;
    };
    switch (incoming.type) {
      case 'ready':
        if (!loadedOnce && !loading) await reload();
        else render();
        break;
      case 'retry':
        await reload();
        break;
      case 'setFilter':
        filter = typeof incoming.value === 'string' ? incoming.value : '';
        render();
        ensureAllLoaded();
        break;
      case 'toggleCwd':
        if (typeof incoming.cwd === 'string' && incoming.cwd.length > 0) {
          changeCwdFilter(
            cwdFilter.includes(incoming.cwd)
              ? cwdFilter.filter((cwd) => cwd !== incoming.cwd)
              : [...cwdFilter, incoming.cwd],
          );
        }
        break;
      case 'clearCwd':
        changeCwdFilter([]);
        break;
      case 'toggleGroup':
        if (typeof incoming.id === 'string') {
          expanded.set(incoming.id, incoming.expanded !== false);
        }
        break;
      case 'open': {
        const request = sessionFromMessage(incoming.session);
        if (request) await deps.openSession(request);
        break;
      }
      case 'action':
        await handleAction(incoming.action, incoming.session);
        break;
      case 'newSession':
        await deps.newSession();
        break;
      case 'loadMore':
        await deps.loadMore(incoming.archived === true);
        break;
      case 'preview': {
        if (typeof incoming.sessionId !== 'string' || incoming.sessionId.length === 0) break;
        const updatedAt = typeof incoming.updatedAt === 'number' ? incoming.updatedAt : null;
        const cached = messageCache.get(incoming.sessionId);
        let preview: SessionPreview;
        if (cached && cached.updatedAt === updatedAt) {
          preview = cached.preview;
        } else {
          try {
            preview = await deps.loadPreview(incoming.sessionId);
          } catch {
            preview = { userMessages: [], lastReply: null };
          }
          messageCache.set(incoming.sessionId, { updatedAt, preview });
        }
        post({
          type: 'preview',
          requestId: incoming.requestId,
          sessionId: incoming.sessionId,
          messages: preview.userMessages,
          reply: preview.lastReply,
        });
        break;
      }
      case 'tick':
        postTimes();
        break;
    }
  }

  return {
    resolveWebviewView(nextView: vscode.WebviewView): void {
      view = nextView;
      console.log('[codex-helper] resolving session webview view');
      nextView.webview.options = { enableScripts: true };
      const nonce = randomUUID().replace(/-/g, '');
      nextView.webview.html = sessionWebviewHtml({
        nonce,
        cspSource: nextView.webview.cspSource,
      });
      const messageSubscription = nextView.webview.onDidReceiveMessage((message) => {
        void handleMessage(message).catch((caught) => {
          error = errorMessage(caught);
          loading = false;
          refresh();
        });
      });
      const disposeSubscription = nextView.onDidDispose(() => {
        messageSubscription.dispose();
        disposeSubscription.dispose();
        if (view === nextView) view = undefined;
      });
      void reload();
    },

    refresh,
    reload,

    setFilter(value: string): void {
      filter = value;
      render();
      ensureAllLoaded();
    },

    clearFilters(): void {
      filter = '';
      changeCwdFilter([]);
    },

    focusSearch(): void {
      post({ type: 'focusSearch' });
    },

    onDidChange(listener: () => void) {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },

    dispose(): void {
      disposed = true;
      listeners.clear();
      view = undefined;
    },
  };
}
