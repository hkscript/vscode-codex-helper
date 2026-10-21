import type { ThreadApi } from '../codex/threadApi';
import type { Thread, ThreadItemRecord } from '../codex/types';
import {
  agentMessageText,
  buildSessionPreview,
  userMessageText,
  type SessionPreview,
} from './sessionPreview';

/**
 * 侧边栏的数据源：未归档与已归档两批会话各自的已加载页和游标，外加悬停预览。
 *
 * 这里只负责取数据；过滤是侧边栏本地做的，所以输入搜索词不会触发往返请求。
 */

export interface SessionSourceDeps {
  /** 每次请求现取：页大小之类的设置改了即时生效。 */
  api(): Pick<ThreadApi, 'listThreads' | 'listItems'>;
  /** `thread/list` 的 cwd 过滤（没开「按工作区过滤」时是 null）。 */
  workspaceCwd(): string | null;
  /** 未归档列表变化之后：fetch 首页或 loadAll/loadMore 合并后的最新快照。 */
  onFetched?(threads: Thread[]): void;
}

export interface SessionPages {
  threads: Thread[];
  archivedThreads: Thread[];
  /** 目录菜单专用：不被单目录服务端过滤收缩。 */
  cwdThreads: Thread[];
  cwdArchivedThreads: Thread[];
  hasMore: boolean;
  archivedHasMore: boolean;
}

export interface SessionSource {
  /**
   * 两批会话并行拉：未归档（置顶/最近/历史）与已归档（「已归档」分组 —— 它同时是
   * 删除入口与撤销归档的地方）。两次请求共用同一个 app-server 握手（start 是幂等的）。
   */
  fetch(): Promise<void>;
  /** 过滤时用：把未归档与已归档的剩余分页都拉完，过滤覆盖全部会话。 */
  loadAll(): Promise<void>;
  /** 给这一批追加下一页；已经没有下一页时什么都不做，返回 false。 */
  loadMore(archived: boolean): Promise<boolean>;
  /** 恰好选中一个目录时用它覆盖 workspaceCwd；0 个或多个目录时仍用工作区。 */
  setCwdFilter(cwdFilter: readonly string[]): Promise<void> | void;
  /**
   * 悬停预览：前两次用户输入 + 最后一次用户输入 + 模型最后回复。
   * 首尾并行拉；尾部扫描到 `final_answer` 为止，找不到最终答复则退回最后一条助手消息。
   */
  loadPreview(threadId: string): Promise<SessionPreview>;
  pages(): SessionPages;
}

export function createSessionSource(deps: SessionSourceDeps): SessionSource {
  let threads: Thread[] = [];
  let archivedThreads: Thread[] = [];
  let cursor: string | null = null;
  let archivedCursor: string | null = null;
  let cwdFilter: readonly string[] = [];
  const threadIds = new Set<string>();
  const archivedThreadIds = new Set<string>();
  const cwdThreads: Thread[] = [];
  const cwdArchivedThreads: Thread[] = [];
  const cwdThreadIds = new Set<string>();
  const cwdArchivedThreadIds = new Set<string>();
  let catalogLoaded = false;
  const loadingMore = new Set<'active' | 'archived'>();
  let operationQueue: Promise<void> = Promise.resolve();

  function currentCwd(): string | null {
    const selected = cwdFilter[0];
    return cwdFilter.length === 1 && selected !== undefined
      ? selected
      : deps.workspaceCwd();
  }

  function appendUnique(
    target: Thread[],
    incoming: readonly Thread[],
    seen: Set<string>,
  ): number {
    let appended = 0;
    for (const thread of incoming) {
      if (seen.has(thread.id)) continue;
      seen.add(thread.id);
      target.push(thread);
      appended += 1;
    }
    return appended;
  }

  function replaceThreads(
    target: Thread[],
    incoming: readonly Thread[],
    seen: Set<string>,
  ): void {
    target.length = 0;
    seen.clear();
    appendUnique(target, incoming, seen);
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function rememberCwdThreads(incoming: readonly Thread[], archived: boolean): void {
    appendUnique(
      archived ? cwdArchivedThreads : cwdThreads,
      incoming,
      archived ? cwdArchivedThreadIds : cwdThreadIds,
    );
  }

  async function collectItems(
    threadId: string,
    direction: 'asc' | 'desc',
    done: (items: ThreadItemRecord[]) => boolean,
  ): Promise<ThreadItemRecord[]> {
    const items: ThreadItemRecord[] = [];
    let next: string | null = null;
    // 最多翻 5 页；正常会话首尾几屏就能找齐，避免异常游标无限翻
    for (let page = 0; page < 5 && !done(items); page += 1) {
      const response = await deps.api().listItems({
        threadId,
        limit: 50,
        sortDirection: direction,
        cursor: next,
      });
      items.push(...(response.data ?? []));
      next = response.nextCursor ?? null;
      if (!next) break;
    }
    return items;
  }

  return {
    fetch() {
      return enqueue(async () => {
        const cwd = currentCwd();
        const [page, archivedPage] = await Promise.all([
          deps.api().listThreads({ cwd, cursor: null }),
          deps.api().listThreads({ cwd, archived: true }),
        ]);
        replaceThreads(threads, page.data ?? [], threadIds);
        replaceThreads(archivedThreads, archivedPage.data ?? [], archivedThreadIds);
        rememberCwdThreads(page.data ?? [], false);
        rememberCwdThreads(archivedPage.data ?? [], true);
        cursor = page.nextCursor ?? null;
        archivedCursor = archivedPage.nextCursor ?? null;
        if (!cwd) {
          catalogLoaded = true;
        } else if (!catalogLoaded) {
          try {
            const catalogCwd = deps.workspaceCwd();
            const [allThreads, allArchived] = await Promise.all([
              deps.api().listThreads({ cwd: catalogCwd, cursor: null }),
              deps.api().listThreads({ cwd: catalogCwd, archived: true }),
            ]);
            rememberCwdThreads(allThreads.data ?? [], false);
            rememberCwdThreads(allArchived.data ?? [], true);
            catalogLoaded = true;
          } catch {
            // 目录目录表只是辅助信息，拉不到不能影响当前筛选结果
          }
        }
        deps.onFetched?.([...threads]);
      });
    },

    loadAll() {
      return enqueue(async () => {
        const cwd = currentCwd();
        let activeAppended = 0;
        const seen = new Set<string>();
        while (cursor && !seen.has(cursor)) {
          seen.add(cursor);
          const page = await deps.api().listThreads({ cwd, cursor });
          activeAppended += appendUnique(threads, page.data ?? [], threadIds);
          rememberCwdThreads(page.data ?? [], false);
          cursor = page.nextCursor ?? null;
        }
        const seenArchived = new Set<string>();
        while (archivedCursor && !seenArchived.has(archivedCursor)) {
          seenArchived.add(archivedCursor);
          const page = await deps.api().listThreads({
            cwd,
            cursor: archivedCursor,
            archived: true,
          });
          appendUnique(archivedThreads, page.data ?? [], archivedThreadIds);
          rememberCwdThreads(page.data ?? [], true);
          archivedCursor = page.nextCursor ?? null;
        }
        if (activeAppended > 0) deps.onFetched?.([...threads]);
      });
    },

    loadMore(archived) {
      const batch = archived ? 'archived' : 'active';
      if (loadingMore.has(batch)) return Promise.resolve(false);
      loadingMore.add(batch);
      return enqueue(async () => {
        try {
          const next = archived ? archivedCursor : cursor;
          if (!next) return false;
          const page = await deps.api().listThreads({
            cwd: currentCwd(),
            cursor: next,
            ...(archived ? { archived: true } : {}),
          });
          if (archived) {
            appendUnique(archivedThreads, page.data ?? [], archivedThreadIds);
            rememberCwdThreads(page.data ?? [], true);
            archivedCursor = page.nextCursor ?? null;
          } else {
            appendUnique(threads, page.data ?? [], threadIds);
            rememberCwdThreads(page.data ?? [], false);
            cursor = page.nextCursor ?? null;
            deps.onFetched?.([...threads]);
          }
          return true;
        } finally {
          loadingMore.delete(batch);
        }
      });
    },

    async loadPreview(threadId) {
      const [first, tail] = await Promise.all([
        collectItems(
          threadId,
          'asc',
          (items) => items.filter((item) => userMessageText(item)).length >= 2,
        ),
        collectItems(
          threadId,
          'desc',
          (items) =>
            items.some((item) => userMessageText(item)) &&
            items.some(
              (item) =>
                item.item?.phase === 'final_answer' && agentMessageText(item) !== null,
            ),
        ),
      ]);
      return buildSessionPreview(first, tail);
    },

    setCwdFilter(nextCwdFilter) {
      cwdFilter = [...nextCwdFilter];
    },

    pages: () => ({
      threads,
      archivedThreads,
      cwdThreads,
      cwdArchivedThreads,
      hasMore: cursor !== null,
      archivedHasMore: archivedCursor !== null,
    }),
  };
}
