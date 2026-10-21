/**
 * 侧边栏 webview 与扩展宿主之间的消息协议。只有类型：宿主（node）和 webview（DOM）
 * 两个 tsconfig 都会检查这个文件，所以这里不能引用任何一边独有的类型。
 *
 * 宿主 → webview 只列 webview 真正读取的字段，宿主实际发的可以更多；
 * webview → 宿主的消息在宿主那边仍按 `unknown` 逐字段校验。
 */

export interface SessionRowData {
  id: string;
  label: string;
  pinned: boolean;
  archived: boolean;
  running: boolean;
  updatedAt: number | null;
  /** 宿主按当前时刻格式化好的相对时间。 */
  time: string;
}

export interface SessionGroupData {
  id: string;
  label: string;
  sessions: SessionRowData[];
}

export interface CwdOptionData {
  path: string;
  label: string;
  count: number;
}

export interface RenderMessage {
  type: 'render';
  groups: SessionGroupData[];
  cwds: CwdOptionData[];
  filter: string;
  cwdFilter: string[];
  expanded: Record<string, boolean>;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  archivedHasMore: boolean;
  loadingAll: boolean;
}

export interface TimesMessage {
  type: 'times';
  times: Record<string, string>;
}

export interface RunningMessage {
  type: 'running';
  ids: string[];
}

export interface PreviewMessage {
  type: 'preview';
  /** 原样回传请求里的 requestId：webview 只认最近一次悬停发出的那个。 */
  requestId: unknown;
  sessionId: string;
  messages: string[];
  reply: string | null;
}

export interface FocusSearchMessage {
  type: 'focusSearch';
}

export type HostMessage =
  | RenderMessage
  | TimesMessage
  | RunningMessage
  | PreviewMessage
  | FocusSearchMessage;

export type SessionAction = 'rename' | 'pin' | 'unpin' | 'archive' | 'unarchive' | 'delete';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'retry' }
  | { type: 'tick' }
  | { type: 'newSession' }
  | { type: 'setFilter'; value: string }
  | { type: 'toggleCwd'; cwd: string }
  | { type: 'clearCwd' }
  | { type: 'toggleGroup'; id: string; expanded: boolean }
  | { type: 'loadMore'; archived: boolean }
  | { type: 'open'; session: { sessionId: string; label: string; archived: boolean } }
  | { type: 'action'; action: SessionAction; session: { sessionId: string; label: string } }
  | { type: 'preview'; sessionId: string; updatedAt: number | null; requestId: number };
