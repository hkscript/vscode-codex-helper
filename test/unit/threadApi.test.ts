import { describe, expect, it } from 'vitest';
import { createThreadApi } from '../../src/codex/threadApi';
import { makeThread, makeTurn } from '../helpers/fakes';

function makeClient() {
  const requests: Array<{ method: string; params: unknown }> = [];
  const client = {
    request<T>(method: string, params?: unknown): Promise<T> {
      requests.push({ method, params });
      if (method === 'thread/list') {
        return Promise.resolve({
          data: [makeThread({ id: 't1', name: '价格排查', updatedAt: 300 })],
          nextCursor: 'c2',
        } as T);
      }
      if (method === 'thread/loaded/list') {
        return Promise.resolve({ data: ['t1'], nextCursor: null } as T);
      }
      return Promise.resolve({} as T);
    },
  };
  return { client, requests };
}

describe('threadApi', () => {
  it('lists_threads_sorted_by_updated_at_excluding_archived', async () => {
    const { client, requests } = makeClient();
    const api = createThreadApi(client);

    const page = await api.listThreads();

    expect(requests[0]!.method).toBe('thread/list');
    expect(requests[0]!.params).toEqual({
      limit: 50,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false,
    });
    expect(page.data.map((thread) => thread.id)).toEqual(['t1']);
    expect(page.nextCursor).toBe('c2');

    // 每页条数可配置
    const small = createThreadApi(client, { pageSize: 5 });
    await small.listThreads();
    expect((requests[1]!.params as { limit: number }).limit).toBe(5);
  });

  it('passes_search_term_to_server', async () => {
    const { client, requests } = makeClient();
    const api = createThreadApi(client);

    await api.listThreads({ searchTerm: 'VSCode' });

    expect(requests[0]!.params).toMatchObject({ searchTerm: 'VSCode' });
  });

  it('passes_workspace_cwd_when_filter_enabled', async () => {
    const { client, requests } = makeClient();
    const api = createThreadApi(client);

    await api.listThreads({ cwd: '/home/hk/github/vscode-codex-helper' });
    expect(requests[0]!.params).toMatchObject({ cwd: '/home/hk/github/vscode-codex-helper' });

    // 关闭工作区过滤时不传 cwd，避免把历史会话挡在服务端
    await api.listThreads({ cwd: null });
    expect(requests[1]!.params).not.toHaveProperty('cwd');
  });

  it('passes_cursor_for_next_page', async () => {
    const { client, requests } = makeClient();
    const api = createThreadApi(client);

    await api.listThreads({ cursor: 'c2' });

    expect(requests[0]!.params).toMatchObject({ cursor: 'c2' });
  });

  it('list_turns_requests_latest_turn_in_descending_order', async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    let turns: unknown[] = [makeTurn({ id: 'turn-2', status: 'interrupted', completedAt: null })];
    const client = {
      request<T>(method: string, params?: unknown): Promise<T> {
        requests.push({ method, params });
        return Promise.resolve({ data: turns } as T);
      },
    };
    const api = createThreadApi(client);

    const latest = await api.listTurns('t1');

    expect(requests[0]!.method).toBe('thread/turns/list');
    // sortDirection 必须是 'desc'：服务端拒绝 'descending'（-32600），design §2
    expect(requests[0]!.params).toEqual({ threadId: 't1', limit: 1, sortDirection: 'desc' });
    expect(latest?.id).toBe('turn-2');

    // 没有任何回合时返回 undefined，而不是抛错或返回空对象
    turns = [];
    expect(await api.listTurns('t1')).toBeUndefined();
  });
});
