import type { UriLike } from '../codex/types';

/**
 * 一行会话在树上的三样信息：会话 id、它已打开时对应标签的 resource、以及是否归档。
 *
 * 节点有两种来源形状：tree item 的 `command.arguments`（平铺）与右键菜单传入的
 * 节点（把会话嵌在 `session` 里）。`readSessionRow` 是唯一读取入口，形状变了只改这里。
 */
export interface SessionRow {
  id: string | null;
  tabUri: UriLike | null;
  archived: boolean;
}

export type OpenTarget =
  | { kind: 'tab'; uri: UriLike }
  | { kind: 'conversation'; id: string };

/**
 * 形状检查：只认真正能交给 `vscode.openWith` 的对象。
 * 必须返回**原对象**而不是重建的副本——生产环境里那是 `vscode.Uri` 实例，
 * 复制成普通对象会让 openWith 拿到一个假 Uri。
 */
function asUriLike(value: unknown): UriLike | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<UriLike>;
  if (typeof candidate.scheme !== 'string') return null;
  if (typeof candidate.authority !== 'string') return null;
  if (typeof candidate.path !== 'string') return null;
  if (typeof candidate.query !== 'string') return null;
  return candidate as UriLike;
}

export function readSessionRow(node: unknown): SessionRow {
  if (!node || typeof node !== 'object') return { id: null, tabUri: null, archived: false };
  const candidate = node as {
    sessionId?: unknown;
    tabUri?: unknown;
    archived?: unknown;
    session?: { id?: unknown; tabUri?: unknown; archived?: unknown };
  };
  const rawId = typeof candidate.sessionId === 'string' ? candidate.sessionId : candidate.session?.id;
  return {
    id: typeof rawId === 'string' && rawId.length > 0 ? rawId : null,
    tabUri: asUriLike(candidate.tabUri) ?? asUriLike(candidate.session?.tabUri),
    archived: candidate.archived === true || candidate.session?.archived === true,
  };
}

/**
 * 判定这一行该打开什么：有标签 resource 就用它——只有它能聚焦那个已经打开的标签，
 * 而且不会丢掉 query 或远端信息；否则按会话 id 打开；两者都没有就不动作。
 */
export function resolveOpenTarget(row: SessionRow): OpenTarget | null {
  if (row.tabUri) return { kind: 'tab', uri: row.tabUri };
  if (row.id) return { kind: 'conversation', id: row.id };
  return null;
}
