import type { UriLike } from '../codex/types';
import { readSessionRow, resolveOpenTarget } from './openTarget';

export interface RowOpenerDeps {
  /** 取消归档：失败时错误由实现方上报，这里只看返回值。 */
  unarchive(threadId: string): Promise<boolean>;
  revealTab(uri: UriLike): Promise<boolean>;
  openSession(id: string): Promise<boolean>;
  /**
   * 这个标签的标题还停在 Codex 默认值（`Codex`）时，把它关掉重开一次，让 Codex 重新
   * resolve 并自己写标题。返回 `true` = 已经重载好了（重开后它就是激活标签，不用再聚焦）；
   * 返回 `false` = 没什么可重载的（标题本来就对）或者重载没做成 —— 两种情况都继续走
   * `revealTab`，所以**失败不会让这一行打不开**。
   *
   * 之所以把重载挂在“点击”上而不是后台自动跑：重载 = 面板重新加载（浏览器里会白一下、
   * 未发送的草稿会丢），只有用户主动点这一行时才值得付这个代价。
   */
  reloadUntitledTab?(uri: UriLike): Promise<boolean>;
}

/**
 * 「点哪行去哪」的编排（design D48）：
 *  1. 归一这一行 → 判定打开目标；目标为空则什么都不做；
 *  2. 这一行是归档的 → **先**取消归档（「点击打开 tab 时回到非归档状态」）。
 *     失败不阻止打开：用户点的是「打开」，前置动作失败不该把它一起吞掉；
 *  3. 有标签 resource → 标题过时就先重载一次（顺带让它变成激活标签），否则聚焦那个标签；
 *     没有标签 resource（会话没打开过）→ 按会话 id 打开（新开的标签本来就会写标题）。
 */
export function createRowOpener(deps: RowOpenerDeps): (node: unknown) => Promise<boolean> {
  return async function openRow(node: unknown): Promise<boolean> {
    const row = readSessionRow(node);
    const target = resolveOpenTarget(row);
    if (!target) return false;
    if (row.archived && row.id) await deps.unarchive(row.id);
    if (target.kind !== 'tab') return deps.openSession(target.id);
    if (deps.reloadUntitledTab && (await deps.reloadUntitledTab(target.uri))) return true;
    return deps.revealTab(target.uri);
  };
}
