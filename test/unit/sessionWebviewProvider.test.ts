import { describe, expect, it, vi } from 'vitest';
import type { SessionSnapshot } from '../../src/ui/sessionWebviewProvider';
import { createSessionWebviewProvider } from '../../src/ui/sessionWebviewProvider';
import { makeThread } from '../helpers/fakes';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    threads: [
      makeThread({ id: 't1', name: '价格排查', cwd: '/work/alpha', updatedAt: 20 }),
      makeThread({ id: 't2', name: '登录重构', cwd: '/work/beta', updatedAt: 10 }),
    ],
    archivedThreads: [
      makeThread({ id: 'z1', name: '旧会话', cwd: '/work/alpha', updatedAt: 5 }),
    ],
    openTabs: [],
    pinnedIds: [],
    runningIds: new Set(['t1']),
    hasMore: false,
    archivedHasMore: false,
    ...overrides,
  };
}

function makeView() {
  const messages: Array<Record<string, unknown>> = [];
  let receive: ((message: unknown) => void) | undefined;
  const view = {
    webview: {
      options: {} as Record<string, unknown>,
      cspSource: 'vscode-webview://test',
      html: '',
      postMessage: async (message: unknown) => {
        messages.push(message as Record<string, unknown>);
        return true;
      },
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        receive = listener;
        return { dispose: () => undefined };
      },
    },
    onDidDispose: () => ({ dispose: () => undefined }),
  };
  return {
    view,
    messages,
    send: async (message: unknown) => {
      receive?.(message);
      await flush();
      await flush();
    },
    lastRender: () => messages.filter((message) => message.type === 'render').at(-1),
  };
}

async function resolvedProvider(
  overrides: Partial<SessionSnapshot> = {},
  options: {
    initialCwdFilter?: string[];
    saveCwdFilter?: (next: string[]) => Promise<void>;
  } = {},
) {
  const fetch = vi.fn(async () => undefined);
  const deps = {
    initialCwdFilter: options.initialCwdFilter,
    saveCwdFilter: options.saveCwdFilter ?? vi.fn(async () => undefined),
    fetch,
    loadAll: vi.fn(async () => undefined),
    loadPreview: vi.fn(async () => ({
      userMessages: ['第一次输入', '第二次输入', '最后一次输入'],
      lastReply: '模型最后回复',
    })),
    snapshot: () => snapshot(overrides),
    loadMore: vi.fn(async () => undefined),
    openSession: vi.fn(async () => undefined),
    newSession: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    pinSession: vi.fn(async () => undefined),
    unpinSession: vi.fn(async () => undefined),
    archiveSession: vi.fn(async () => undefined),
    unarchiveSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    now: () => 20 + 60_000,
  };
  const provider = createSessionWebviewProvider(deps);
  const fake = makeView();
  provider.resolveWebviewView(fake.view as never);
  await flush();
  await flush();
  return { provider, deps, ...fake };
}

describe('sessionWebviewProvider', () => {
  it('ships_a_syntactically_valid_webview_script', async () => {
    const { view } = await resolvedProvider();
    const script = /<script nonce="[^"]*">([\s\S]*?)<\/script>/.exec(view.webview.html)?.[1];

    expect(script).toBeDefined();
    // 只解析、不执行：这里要抓的是模板字符串里漏转义之类的语法错误
    expect(() => new Function(script!)).not.toThrow();
  });

  it('renders_inline_search_groups_directory_options_and_relative_times', async () => {
    const { view, lastRender } = await resolvedProvider();

    expect(view.webview.html).toContain('Search sessions...');
    expect(view.webview.html).toContain('Active');
    const payload = lastRender()!;
    expect(payload.activeCount).toBe(1);
    expect(payload.cwds).toEqual([
      { path: '/work/alpha', label: 'alpha', count: 2 },
      { path: '/work/beta', label: 'beta', count: 1 },
    ]);
    const groups = payload.groups as Array<{ id: string; sessions: Array<{ id: string; time: string }> }>;
    const recent = groups.find((group) => group.id === 'recent')!;
    expect(recent.sessions.map((session) => session.id)).toEqual(['t1', 't2']);
    expect(recent.sessions[0]!.time).toBe('1m');
  });

  it('filters_locally_as_the_user_types', async () => {
    const { send, lastRender } = await resolvedProvider();

    await send({ type: 'setFilter', value: '价格' });

    const payload = lastRender()!;
    const groups = payload.groups as Array<{ sessions: Array<{ id: string }> }>;
    expect(payload.filter).toBe('价格');
    expect(groups.flatMap((group) => group.sessions.map((session) => session.id))).toEqual(['t1']);
    expect(payload.activeCount).toBe(1);
  });

  it('loads_all_remaining_pages_once_a_filter_is_active', async () => {
    const { send, deps } = await resolvedProvider({ hasMore: true });

    await send({ type: 'setFilter', value: '价格' });

    expect(deps.loadAll).toHaveBeenCalledTimes(1);
  });

  it('filters_by_exact_working_directory', async () => {
    const { send, lastRender } = await resolvedProvider();

    await send({ type: 'toggleCwd', cwd: '/work/beta' });

    const payload = lastRender()!;
    const groups = payload.groups as Array<{ sessions: Array<{ id: string; cwd: string }> }>;
    const visible = groups.flatMap((group) => group.sessions);
    expect(payload.cwdFilter).toEqual(['/work/beta']);
    expect(visible.map((session) => session.id)).toEqual(['t2']);
    expect(visible[0]!.cwd).toBe('/work/beta');
  });

  it('supports_selecting_multiple_working_directories', async () => {
    const { send, lastRender } = await resolvedProvider();

    await send({ type: 'toggleCwd', cwd: '/work/alpha' });
    await send({ type: 'toggleCwd', cwd: '/work/beta' });

    const payload = lastRender()!;
    const groups = payload.groups as Array<{ sessions: Array<{ id: string }> }>;
    expect(payload.cwdFilter).toEqual(['/work/alpha', '/work/beta']);
    expect(groups.flatMap((group) => group.sessions.map((session) => session.id))).toEqual([
      't1',
      't2',
      'z1',
    ]);

    // 再点一次是取消该目录，而不是清空全部
    await send({ type: 'toggleCwd', cwd: '/work/alpha' });
    expect(lastRender()!.cwdFilter).toEqual(['/work/beta']);
  });

  it('restores_and_persists_directory_selection_for_the_workspace', async () => {
    const saveCwdFilter = vi.fn(async () => undefined);
    const { send, lastRender } = await resolvedProvider(
      {},
      { initialCwdFilter: ['/work/beta'], saveCwdFilter },
    );

    // 初始化时直接应用上次选择
    expect(lastRender()!.cwdFilter).toEqual(['/work/beta']);
    const groups = lastRender()!.groups as Array<{ sessions: Array<{ id: string }> }>;
    expect(groups.flatMap((group) => group.sessions.map((session) => session.id))).toEqual(['t2']);

    await send({ type: 'toggleCwd', cwd: '/work/alpha' });
    expect(saveCwdFilter).toHaveBeenLastCalledWith(['/work/beta', '/work/alpha']);

    await send({ type: 'clearCwd' });
    expect(saveCwdFilter).toHaveBeenLastCalledWith([]);
  });

  it('keeps_group_expansion_across_filter_renders', async () => {
    const { send, lastRender } = await resolvedProvider({
      threads: Array.from({ length: 12 }, (_, index) =>
        makeThread({ id: `t${index}`, name: `会话${index}`, updatedAt: 100 - index }),
      ),
    });

    // 默认「历史」收起；用户展开后，下一次过滤重绘仍然展开
    await send({ type: 'toggleGroup', id: 'history', expanded: true });
    await send({ type: 'setFilter', value: '' });

    const payload = lastRender()!;
    expect((payload.expanded as Record<string, boolean>).history).toBe(true);
  });

  it('forwards_session_identity_without_serializing_a_vscode_uri', async () => {
    const { send, deps } = await resolvedProvider();

    await send({
      type: 'open',
      session: { sessionId: 't1', label: '价格排查', archived: false },
    });

    expect(deps.openSession).toHaveBeenCalledWith({
      sessionId: 't1',
      label: '价格排查',
      tabUri: null,
      archived: false,
    });
  });

  it('routes_context_menu_actions_to_the_extension_handlers', async () => {
    const { send, deps } = await resolvedProvider();

    await send({
      type: 'action',
      action: 'delete',
      session: { sessionId: 'z1', label: '旧会话' },
    });
    await send({ type: 'action', action: 'pin', session: { sessionId: 't2' } });
    await send({ type: 'action', action: 'rename', session: { sessionId: 't2', label: '新名字' } });

    expect(deps.deleteSession).toHaveBeenCalledWith('z1');
    expect(deps.pinSession).toHaveBeenCalledWith('t2');
    expect(deps.renameSession).toHaveBeenCalledWith('t2', '新名字');
  });

  it('keeps_unarchived_and_archived_pagination_separate', async () => {
    const { send, deps, lastRender } = await resolvedProvider({
      hasMore: true,
      archivedHasMore: true,
    });

    expect(lastRender()!.hasMore).toBe(true);
    expect(lastRender()!.archivedHasMore).toBe(true);

    await send({ type: 'loadMore', archived: false });
    await send({ type: 'loadMore', archived: true });

    expect(deps.loadMore).toHaveBeenNthCalledWith(1, false);
    expect(deps.loadMore).toHaveBeenNthCalledWith(2, true);
  });

  it('loads_and_caches_the_hover_preview_user_messages', async () => {
    const { send, deps, messages } = await resolvedProvider();

    await send({ type: 'preview', sessionId: 't1', updatedAt: 20, requestId: 7 });
    await send({ type: 'preview', sessionId: 't1', updatedAt: 20, requestId: 8 });

    const previews = messages.filter((message) => message.type === 'preview');
    expect(previews.at(-1)).toMatchObject({
      requestId: 8,
      sessionId: 't1',
      messages: ['第一次输入', '第二次输入', '最后一次输入'],
      reply: '模型最后回复',
    });
    // 同一个 updatedAt 只读一次会话
    expect(deps.loadPreview).toHaveBeenCalledTimes(1);
  });

  it('shows_a_retryable_error_when_loading_fails', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('spawn ENOENT');
    });
    const deps = {
      fetch,
      loadAll: vi.fn(),
      loadPreview: vi.fn(async () => ({ userMessages: [], lastReply: null })),
      snapshot: () => snapshot(),
      loadMore: vi.fn(),
      openSession: vi.fn(),
      newSession: vi.fn(),
      renameSession: vi.fn(),
      pinSession: vi.fn(),
      unpinSession: vi.fn(),
      archiveSession: vi.fn(),
      unarchiveSession: vi.fn(),
      deleteSession: vi.fn(),
    };
    const provider = createSessionWebviewProvider(deps);
    const fake = makeView();
    provider.resolveWebviewView(fake.view as never);
    await flush();
    await flush();

    expect(fake.lastRender()!.error).toContain('spawn ENOENT');

    await fake.send({ type: 'retry' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('notifies_refresh_listeners_and_supports_external_filter_commands', async () => {
    const { provider, lastRender } = await resolvedProvider();
    const listener = vi.fn();
    provider.onDidChange(listener);

    provider.refresh();
    expect(listener).toHaveBeenCalledTimes(1);

    provider.setFilter('登录');
    const groups = lastRender()!.groups as Array<{ sessions: Array<{ id: string }> }>;
    expect(groups.flatMap((group) => group.sessions.map((session) => session.id))).toEqual(['t2']);

    provider.clearFilters();
    expect(lastRender()!.filter).toBe('');
    expect(lastRender()!.cwdFilter).toEqual([]);
  });
});
