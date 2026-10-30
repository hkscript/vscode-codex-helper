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
  it('fetch_replaces_both_batches_and_reports_each_merged_active_page', async () => {
    const { source, fetched, ids } = createHarness({
      'active:': { ids: ['a1', 'a2'], next: 'c1' },
      'archived:': { ids: ['z1'] },
      'active:c1': { ids: ['a3'] },
    });

    await source.fetch();
    expect(ids(source.pages().threads)).toEqual(['a1', 'a2']);
    expect(ids(source.pages().archivedThreads)).toEqual(['z1']);
    expect(source.pages()).toMatchObject({ hasMore: true, archivedHasMore: false });

    // 追加分页后也要刷新运行状态判定，且回调看到的是合并后的未归档列表
    expect(await source.loadMore(false)).toBe(true);
    expect(ids(source.pages().threads)).toEqual(['a1', 'a2', 'a3']);
    expect(fetched.map(ids)).toEqual([
      ['a1', 'a2'],
      ['a1', 'a2', 'a3'],
    ]);
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
    const { source, fetched, ids } = createHarness({
      'active:': { ids: ['a1'], next: 'c1' },
      'active:c1': { ids: ['a2'], next: 'c2' },
      // 异常游标：服务端反复给同一个，不能无限翻
      'active:c2': { ids: ['a3'], next: 'c2' },
      'archived:': { ids: ['z1'], next: 'z-c1' },
      'archived:z-c1': { ids: ['z2'] },
    });
    await source.fetch();
    fetched.length = 0;

    await source.loadAll();

    expect(ids(source.pages().threads)).toEqual(['a1', 'a2', 'a3']);
    expect(ids(source.pages().archivedThreads)).toEqual(['z1', 'z2']);
    expect(source.pages().archivedHasMore).toBe(false);
    expect(fetched.map(ids)).toEqual([['a1', 'a2', 'a3']]);
  });

  it('serializes_fetch_behind_load_all_instead_of_using_conflicting_cursors', async () => {
    const queries: ThreadListQuery[] = [];
    let releaseNextPage!: () => void;
    const nextPageGate = new Promise<void>((resolve) => {
      releaseNextPage = resolve;
    });
    let activeRootCalls = 0;
    const source = createSessionSource({
      api: () => ({
        listThreads: async (query: ThreadListQuery = {}): Promise<ThreadListResponse> => {
          queries.push(query);
          if (query.cursor === 'a-next') {
            await nextPageGate;
            return { data: [makeThread({ id: 'a2' })], nextCursor: null };
          }
          if (query.archived) return { data: [], nextCursor: null };
          activeRootCalls += 1;
          return activeRootCalls === 1
            ? { data: [makeThread({ id: 'a1' })], nextCursor: 'a-next' }
            : { data: [makeThread({ id: 'fresh' })], nextCursor: null };
        },
        listItems: async () => ({ data: [], nextCursor: null }),
      }),
      workspaceCwd: () => '/repo',
    });

    await source.fetch();
    queries.length = 0;

    const loadAll = source.loadAll();
    await Promise.resolve();
    const refresh = source.fetch();
    await Promise.resolve();

    // loadAll 的首个请求还卡在闸门里时，fetch 不得抢跑并重新使用 cursor=null。
    expect(queries).toEqual([{ cwd: '/repo', cursor: 'a-next' }]);

    releaseNextPage();
    await Promise.all([loadAll, refresh]);
    expect(queries).toEqual([
      { cwd: '/repo', cursor: 'a-next' },
      { cwd: '/repo', cursor: null },
      { cwd: '/repo', archived: true },
    ]);
    expect(source.pages().threads.map((thread) => thread.id)).toEqual(['fresh']);
  });

  it('deduplicates_concurrent_load_more_for_the_same_batch_and_cursor', async () => {
    const { source, queries, ids } = createHarness({
      'active:': { ids: ['a1'], next: 'c1' },
      'archived:': { ids: [] },
      'active:c1': { ids: ['a2'] },
    });
    await source.fetch();
    queries.length = 0;

    const first = source.loadMore(false);
    const second = source.loadMore(false);

    expect(await second).toBe(false);
    expect(await first).toBe(true);
    expect(queries).toEqual([{ cwd: '/repo', cursor: 'c1' }]);
    expect(ids(source.pages().threads)).toEqual(['a1', 'a2']);
  });

  it('deduplicates_appended_threads_by_id', async () => {
    const { source, ids } = createHarness({
      'active:': { ids: ['a1', 'a2'], next: 'c1' },
      'archived:': { ids: ['z1'], next: 'z-c1' },
      'active:c1': { ids: ['a2', 'a3'] },
      'archived:z-c1': { ids: ['z1', 'z2'] },
    });
    await source.fetch();

    await source.loadMore(false);
    await source.loadMore(true);

    expect(ids(source.pages().threads)).toEqual(['a1', 'a2', 'a3']);
    expect(ids(source.pages().archivedThreads)).toEqual(['z1', 'z2']);
  });

  it('uses_a_single_selected_cwd_for_subsequent_thread_lists', async () => {
    const { source, queries } = createHarness({
      'active:': { ids: ['a1'], next: 'c1' },
      'archived:': { ids: [] },
      'active:c1': { ids: ['a2'] },
    });
    await source.fetch();
    queries.length = 0;

    await source.setCwdFilter(['/selected']);
    await source.loadMore(false);

    expect(queries).toEqual([{ cwd: '/selected', cursor: 'c1' }]);

    queries.length = 0;
    await source.setCwdFilter(['/one', '/two']);
    await source.fetch();

    expect(queries).toEqual([
      { cwd: '/repo', cursor: null },
      { cwd: '/repo', archived: true },
    ]);
  });

  it('keeps_an_unfiltered_directory_catalog_when_the_list_is_server_filtered', async () => {
    const source = createSessionSource({
      api: () => ({
        listThreads: async (query: ThreadListQuery = {}): Promise<ThreadListResponse> => {
          if (query.archived) return { data: [], nextCursor: null };
          if (query.cwd === '/selected') {
            return {
              data: [makeThread({ id: 'selected', cwd: '/selected' })],
              nextCursor: null,
            };
          }
          return {
            data: [
              makeThread({ id: 'selected', cwd: '/selected' }),
              makeThread({ id: 'other', cwd: '/other' }),
            ],
            nextCursor: null,
          };
        },
        listItems: async () => ({ data: [], nextCursor: null }),
      }),
      workspaceCwd: () => '/repo',
    });

    source.setCwdFilter(['/selected']);
    await source.fetch();

    expect(source.pages().threads.map((thread) => thread.id)).toEqual(['selected']);
    expect(source.pages().cwdThreads.map((thread) => thread.id).sort()).toEqual([
      'other',
      'selected',
    ]);
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

  it('searches_content_in_user_inputs_and_final_answers', async () => {
    const user = (text: string): ThreadItemRecord => ({
      item: { type: 'userMessage', content: [{ type: 'text', text }] },
    });
    const reply = (text: string, phase?: string): ThreadItemRecord => ({
      item: { type: 'agentMessage', text, phase },
    });
    const items: Record<string, ThreadItemRecord[]> = {
      input: [user('历史输入里有 KNeedle')],
      final: [reply('最终回复里有 KNeedle', 'final_answer')],
      progress: [reply('中间过程里有关键词')],
      commentary: [user('没有目标词'), reply('普通回复里有关键词')],
    };
    const orders: string[] = [];
    const source = createSessionSource({
      api: () => ({
        listThreads: async () => ({ data: [], nextCursor: null }),
        listItems: async (query) => {
          orders.push(query.sortDirection ?? '');
          return { data: items[query.threadId] ?? [], nextCursor: null };
        },
      }),
      workspaceCwd: () => null,
    });

    const matched = await source.searchContent('kneedle', [
      'input',
      'final',
      'progress',
      'commentary',
    ]);

    expect(matched).toEqual(new Set(['input', 'final']));
    expect(orders).toHaveLength(4);
    expect(new Set(orders)).toEqual(new Set(['desc']));
  });
});
