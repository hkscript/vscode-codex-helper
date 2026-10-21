import { describe, expect, it } from 'vitest';
import type { ThreadListQuery } from '../../src/codex/threadApi';
import type { Thread, ThreadItemRecord, ThreadListResponse } from '../../src/codex/types';
import { createSessionSource } from '../../src/session/sessionSource';
import { makeThread } from '../helpers/fakes';

/** 按 (archived, cursor) 给页：没登记的页返回空页、没有下一页。 */
function createHarness(pages: Record<string, { ids: string[]; next?: string }>) {
  const queries: ThreadListQuery[] = [];
  const fetched: Thread[][] = [];
  const source = createSessionSource({
    api: () => ({
      listThreads: async (query: ThreadListQuery = {}): Promise<ThreadListResponse> => {
        queries.push(query);
        const page = pages[`${query.archived ? 'archived' : 'active'}:${query.cursor ?? ''}`];
        return {
          data: (page?.ids ?? []).map((id) => makeThread({ id })),
          nextCursor: page?.next ?? null,
        };
      },
      listItems: async () => ({ data: [], nextCursor: null }),
    }),
    workspaceCwd: () => '/repo',
    onFetched: (threads) => fetched.push(threads),
  });
  const ids = (threads: Thread[]) => threads.map((thread) => thread.id);
  return { source, queries, fetched, ids };
}

describe('sessionSource', () => {
  it('fetch_replaces_both_batches_and_reports_only_the_first_active_page', async () => {
    const { source, fetched, ids } = createHarness({
      'active:': { ids: ['a1', 'a2'], next: 'c1' },
      'archived:': { ids: ['z1'] },
      'active:c1': { ids: ['a3'] },
    });

    await source.fetch();
    expect(ids(source.pages().threads)).toEqual(['a1', 'a2']);
    expect(ids(source.pages().archivedThreads)).toEqual(['z1']);
    expect(source.pages()).toMatchObject({ hasMore: true, archivedHasMore: false });

    // 追加的分页不再喂给运行状态判定：只有首页刷新才算「最新列表」
    expect(await source.loadMore(false)).toBe(true);
    expect(ids(source.pages().threads)).toEqual(['a1', 'a2', 'a3']);
    expect(fetched.map(ids)).toEqual([['a1', 'a2']]);
  });

  it('load_more_only_touches_the_requested_batch_and_skips_when_exhausted', async () => {
    const { source, queries, ids } = createHarness({
      'active:': { ids: ['a1'] },
      'archived:': { ids: ['z1'], next: 'z-c1' },
      'archived:z-c1': { ids: ['z2'] },
    });
    await source.fetch();
    queries.length = 0;

    expect(await source.loadMore(false)).toBe(false);
    expect(queries).toEqual([]);

    expect(await source.loadMore(true)).toBe(true);
    expect(queries).toEqual([{ cwd: '/repo', cursor: 'z-c1', archived: true }]);
    expect(ids(source.pages().threads)).toEqual(['a1']);
    expect(ids(source.pages().archivedThreads)).toEqual(['z1', 'z2']);
    expect(source.pages().archivedHasMore).toBe(false);
  });

  it('load_all_drains_both_batches_and_stops_on_a_repeating_cursor', async () => {
    const { source, ids } = createHarness({
      'active:': { ids: ['a1'], next: 'c1' },
      'active:c1': { ids: ['a2'], next: 'c2' },
      // 异常游标：服务端反复给同一个，不能无限翻
      'active:c2': { ids: ['a3'], next: 'c2' },
      'archived:': { ids: ['z1'], next: 'z-c1' },
      'archived:z-c1': { ids: ['z2'] },
    });
    await source.fetch();

    await source.loadAll();

    expect(ids(source.pages().threads)).toEqual(['a1', 'a2', 'a3']);
    expect(ids(source.pages().archivedThreads)).toEqual(['z1', 'z2']);
    expect(source.pages().archivedHasMore).toBe(false);
  });

  it('preview_reads_the_head_ascending_and_the_tail_descending', async () => {
    const user = (text: string): ThreadItemRecord => ({
      item: { type: 'userMessage', content: [{ type: 'text', text }] },
    });
    const reply: ThreadItemRecord = {
      item: { type: 'agentMessage', text: '答复', phase: 'final_answer' },
    };
    const directions: Array<string | undefined> = [];
    const source = createSessionSource({
      api: () => ({
        listThreads: async () => ({ data: [], nextCursor: null }),
        listItems: async (query) => {
          directions.push(query.sortDirection);
          return query.sortDirection === 'asc'
            ? { data: [user('第一条'), user('第二条')], nextCursor: 'more' }
            : { data: [user('最后一条'), reply], nextCursor: 'more' };
        },
      }),
      workspaceCwd: () => null,
    });

    const preview = await source.loadPreview('t1');

    // 首尾各一页就找齐了：不再往下翻
    expect(directions.sort()).toEqual(['asc', 'desc']);
    expect(preview).toEqual({ userMessages: ['第一条', '第二条', '最后一条'], lastReply: '答复' });
  });
});
