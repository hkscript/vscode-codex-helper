import type { ThreadListResponse } from './types';

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
}

export interface ThreadApi {
  listThreads(query?: ThreadListQuery): Promise<ThreadListResponse>;
  listLoadedThreadIds(): Promise<string[]>;
  setThreadName(threadId: string, name: string): Promise<void>;
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
        archived: false,
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
  };
}
