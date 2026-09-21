/**
 * Shared types for the Codex session sidebar.
 *
 * Nothing in this file may import `vscode`: every module that needs the editor
 * API receives the pieces it uses through injection so it stays unit-testable.
 */

/** The subset of `vscode.Uri` this extension relies on. */
export interface UriLike {
  scheme: string;
  authority: string;
  path: string;
  query: string;
}

export interface UriLikeWith extends UriLike {
  with(change: Partial<UriLike>): UriLike;
}

/** `vscode.Uri` statics, narrowed to what we call. */
export interface UriApi {
  file(path: string): UriLikeWith;
  parse(value: string): UriLikeWith;
}

/** `vscode.Memento` narrowed to what the pin store uses. */
export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** A Codex conversation as returned by `thread/list`. */
export interface Thread {
  id: string;
  name?: string | null;
  preview: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  /** Rollout file path. Optional: the file is created lazily on the first turn. */
  path?: string | null;
}

export type TurnStatus = 'inProgress' | 'completed' | 'interrupted' | 'failed';

/**
 * One turn as returned by `thread/turns/list`.
 *
 * Cross-process reads encode a turn that is *still running* as
 * `interrupted` + `completedAt: null` — see design.md D15.
 */
export interface Turn {
  id: string;
  status: TurnStatus;
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface ThreadListResponse {
  data: Thread[];
  nextCursor: string | null;
}

/** A Codex custom editor tab found in the current window. */
export interface OpenTab {
  /** `null` for a freshly created panel that is not bound to a conversation yet. */
  id: string | null;
  tabLabel: string;
}

/** One row rendered in the tree. */
export interface SessionItem {
  id: string;
  label: string;
  preview: string;
  cwd: string | null;
  updatedAt: number | null;
  pinned: boolean;
  open: boolean;
  running: boolean;
}

export type SessionGroupId = 'open' | 'pinned' | 'history';

export interface SessionGroup {
  id: SessionGroupId;
  label: string;
  sessions: SessionItem[];
}
