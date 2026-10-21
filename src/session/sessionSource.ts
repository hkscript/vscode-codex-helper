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
  /** 首页重新拉回来之后：最新的未归档会话（分页追加的不算）。 */
  onFetched?(threads: Thread[]): void;
}

export interface SessionPages {
  threads: Thread[];
  archivedThreads: Thread[];
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
    async fetch() {
      const [page, archivedPage] = await Promise.all([
        deps.api().listThreads({ cwd: deps.workspaceCwd(), cursor: null }),
        deps.api().listThreads({ cwd: deps.workspaceCwd(), archived: true }),
      ]);
      threads = page.data ?? [];
      archivedThreads = archivedPage.data ?? [];
      cursor = page.nextCursor ?? null;
      archivedCursor = archivedPage.nextCursor ?? null;
      deps.onFetched?.(threads);
    },

    async loadAll() {
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const page = await deps.api().listThreads({ cwd: deps.workspaceCwd(), cursor });
        threads = [...threads, ...(page.data ?? [])];
        cursor = page.nextCursor ?? null;
      }
      const seenArchived = new Set<string>();
      while (archivedCursor && !seenArchived.has(archivedCursor)) {
        seenArchived.add(archivedCursor);
        const page = await deps.api().listThreads({
          cwd: deps.workspaceCwd(),
          cursor: archivedCursor,
          archived: true,
        });
        archivedThreads = [...archivedThreads, ...(page.data ?? [])];
        archivedCursor = page.nextCursor ?? null;
      }
    },

    async loadMore(archived) {
      const next = archived ? archivedCursor : cursor;
      if (!next) return false;
      const page = await deps.api().listThreads({
        cwd: deps.workspaceCwd(),
        cursor: next,
        ...(archived ? { archived: true } : {}),
      });
      if (archived) {
        archivedThreads = [...archivedThreads, ...(page.data ?? [])];
        archivedCursor = page.nextCursor ?? null;
      } else {
        threads = [...threads, ...(page.data ?? [])];
        cursor = page.nextCursor ?? null;
      }
      return true;
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

    pages: () => ({
      threads,
      archivedThreads,
      hasMore: cursor !== null,
      archivedHasMore: archivedCursor !== null,
    }),
  };
}
