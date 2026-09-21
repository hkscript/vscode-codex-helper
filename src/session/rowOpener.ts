import type { UriLike } from '../codex/types';
import { readSessionRow, resolveOpenTarget } from './openTarget';

export interface RowOpenerDeps {
  /** 取消归档：失败时错误由实现方上报，这里只看返回值。 */
  unarchive(threadId: string): Promise<boolean>;
  revealTab(uri: UriLike): Promise<boolean>;
  openSession(id: string): Promise<boolean>;
}

/**
 * 「点哪行去哪」的编排（design D48）：
 *  1. 归一这一行 → 判定打开目标；目标为空则什么都不做；
 *  2. 这一行是归档的 → **先**取消归档（「点击打开 tab 时回到非归档状态」）。
 *     失败不阻止打开：用户点的是「打开」，前置动作失败不该把它一起吞掉；
 *  3. 有标签 resource → 聚焦那个标签；否则按会话 id 打开。
 */
export function createRowOpener(deps: RowOpenerDeps): (node: unknown) => Promise<boolean> {
  return async function openRow(node: unknown): Promise<boolean> {
    const row = readSessionRow(node);
    const target = resolveOpenTarget(row);
    if (!target) return false;
    if (row.archived && row.id) await deps.unarchive(row.id);
    return target.kind === 'tab' ? deps.revealTab(target.uri) : deps.openSession(target.id);
  };
}
