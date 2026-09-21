import type { ThreadListResponse, Turn } from './types';

/**
 * Typed wrapper over the three app-server thread methods we use.
 * Parameter names/enums come from `codex app-server generate-json-schema`
 * (`ThreadListParams`, `ThreadSetNameParams`) — see design.md §2.2.
 */

export interface ThreadApiClient {
  request<T>(method: string, params?: unknown): Promise<T>;
}

export interface ThreadListQuery {
  searchTerm?: string | null;
  cwd?: string | null;
  cursor?: string | null;
  /** `true` 时只列已归档会话（`thread/list` 的 `archived` 过滤器）。 */
  archived?: boolean;
}

export interface ThreadApi {
  listThreads(query?: ThreadListQuery): Promise<ThreadListResponse>;
  listLoadedThreadIds(): Promise<string[]>;
  setThreadName(threadId: string, name: string): Promise<void>;
  archiveThread(threadId: string): Promise<void>;
  unarchiveThread(threadId: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  listTurns(threadId: string, limit?: number): Promise<Turn | undefined>;
}

export const DEFAULT_PAGE_SIZE = 50;

export function createThreadApi(
  client: ThreadApiClient,
  options: { pageSize?: number } = {},
): ThreadApi {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  return {
    async listThreads(query: ThreadListQuery = {}): Promise<ThreadListResponse> {
      const params: Record<string, unknown> = {
        limit: pageSize,
        sortKey: 'updated_at',
        sortDirection: 'desc',
        // 「已归档」分组要单独拉一页；不传时仍然只列未归档。
        archived: query.archived ?? false,
      };
      // Optional filters are omitted (not sent as null) so the server keeps its
      // own defaults instead of filtering on an empty value.
      if (query.searchTerm) params.searchTerm = query.searchTerm;
      if (query.cwd) params.cwd = query.cwd;
      if (query.cursor) params.cursor = query.cursor;
      return client.request<ThreadListResponse>('thread/list', params);
    },

    async listLoadedThreadIds(): Promise<string[]> {
      const response = await client.request<{ data?: string[] }>('thread/loaded/list');
      return response?.data ?? [];
    },

    async setThreadName(threadId: string, name: string): Promise<void> {
      await client.request('thread/name/set', { threadId, name });
    },

    // 归档三件套：参数形状取自 `codex app-server generate-json-schema` 的
    // ThreadArchiveParams / ThreadUnarchiveParams / ThreadDeleteParams（都只有 threadId）。
    async archiveThread(threadId: string): Promise<void> {
      await client.request('thread/archive', { threadId });
    },

    async unarchiveThread(threadId: string): Promise<void> {
      await client.request('thread/unarchive', { threadId });
    },

    async deleteThread(threadId: string): Promise<void> {
      await client.request('thread/delete', { threadId });
    },

    // `sortDirection` only accepts 'asc' / 'desc'; 'descending' is rejected
    // with -32600 (design.md §2).
    async listTurns(threadId: string, limit = 1): Promise<Turn | undefined> {
      const response = await client.request<{ data?: Turn[] }>('thread/turns/list', {
        threadId,
        limit,
        sortDirection: 'desc',
      });
      return response?.data?.[0];
    },
  };
}
