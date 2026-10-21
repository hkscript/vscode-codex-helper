import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/log';
import type { UriLike } from '../../src/codex/types';
import type { SessionSnapshot } from '../../src/ui/sessionWebviewProvider';
import {
  createSessionWebviewProvider,
  sessionWebviewAssets,
} from '../../src/ui/sessionWebviewProvider';
import { Uri, makeThread } from '../helpers/fakes';

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** 扩展装在 /ext：webview 资源都在 /ext/dist/webview 下。 */
const assets = sessionWebviewAssets(Uri.file('/ext') as never, (base, ...segments) =>
  Uri.joinPath(base as never, ...segments) as never,
);

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
  const visibilityListeners = new Set<() => void>();
  const view = {
    visible: true,
    onDidChangeVisibility: (listener: () => void) => {
      visibilityListeners.add(listener);
      return { dispose: () => visibilityListeners.delete(listener) };
    },
    webview: {
      options: {} as Record<string, unknown>,
      cspSource: 'vscode-webview://test',
      html: '',
      asWebviewUri: (uri: UriLike) => ({ toString: () => `https://webview.test${uri.path}` }),
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
    /** 模拟侧边栏被折叠 / 切走（retainContextWhenHidden 下 webview 仍活着）与切回。 */
    setVisible: async (visible: boolean) => {
      view.visible = visible;
      for (const listener of [...visibilityListeners]) listener();
      await flush();
      await flush();
    },
  };
}

async function resolvedProvider(
  overrides: Partial<SessionSnapshot> = {},
  options: {
    initialCwdFilter?: string[];
    saveCwdFilter?: (next: string[]) => Promise<void>;
    logger?: Logger;
  } = {},
) {
  const fetch = vi.fn(async () => undefined);
  const deps = {
    assets,
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
    logger: options.logger,
  };
  const provider = createSessionWebviewProvider(deps);
  const fake = makeView();
  provider.resolveWebviewView(fake.view as never);
  await flush();
  await flush();
  return { provider, deps, ...fake };
}

describe('sessionWebviewProvider', () => {
  it('loads_the_bundled_script_and_stylesheet_under_a_strict_csp', async () => {
    const { view } = await resolvedProvider();
    const html = view.webview.html;

    expect(assets.root.path).toBe('/ext/dist/webview');
    // webview 只能读扩展自己的 dist/webview，别的本地文件一概不放行
    expect(view.webview.options).toEqual({
      enableScripts: true,
      localResourceRoots: [assets.root],
    });
    expect(html).toContain(
      '<link rel="stylesheet" href="https://webview.test/ext/dist/webview/sidebar.css" />',
    );
    const script = /<script nonce="([0-9a-f]{32})" src="([^"]*)"><\/script>/.exec(html);
    expect(script?.[2]).toBe('https://webview.test/ext/dist/webview/sidebar.js');
    const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1];
    expect(csp).toBe(
      `default-src 'none'; style-src vscode-webview://test; script-src 'nonce-${script![1]}';`,
    );
    // 不再有内联样式 / 内联脚本：唯一的 <script> 就是上面那个外链
    expect(html).not.toContain('<style');
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it('uses_a_fresh_nonce_for_every_resolved_view', async () => {
    const first = await resolvedProvider();
    const second = await resolvedProvider();
    const nonce = (html: string) => /script-src 'nonce-([^']+)'/.exec(html)?.[1];

    expect(nonce(first.view.webview.html)).toBeDefined();
    expect(nonce(first.view.webview.html)).not.toBe(nonce(second.view.webview.html));
  });

  it('renders_inline_search_groups_directory_options_and_relative_times', async () => {
    const { view, lastRender } = await resolvedProvider();

    expect(view.webview.html).toContain('Search sessions...');
    expect(view.webview.html).not.toContain('Active ·');
    const payload = lastRender()!;
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
  });

  it('loads_all_remaining_pages_once_a_filter_is_active', async () => {
    const { send, deps } = await resolvedProvider({ hasMore: true });

    await send({ type: 'setFilter', value: '价格' });

    expect(deps.loadAll).toHaveBeenCalledTimes(1);
  });

  it('logs_an_error_when_loading_the_remaining_pages_fails', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { send, deps } = await resolvedProvider({ hasMore: true }, { logger });
    deps.loadAll.mockRejectedValueOnce(new Error('thread/list timeout'));

    await send({ type: 'setFilter', value: '价格' });

    expect(logger.error).toHaveBeenCalledWith('加载全部会话失败：thread/list timeout');
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
      assets,
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

  it('coalesces_reloads_requested_while_one_is_in_flight', async () => {
    const { provider, deps, messages } = await resolvedProvider();
    const rounds: Array<() => void> = [];
    deps.fetch.mockImplementation(
      () => new Promise<undefined>((resolve) => rounds.push(() => resolve(undefined))),
    );
    const before = deps.fetch.mock.calls.length;

    let settled = 0;
    const first = provider.reload().then(() => (settled += 1));
    // 第一轮还在拉：这两次不能各自再发一轮（并发结果谁后到谁覆盖），只排一轮补拉
    const second = provider.reload().then(() => (settled += 1));
    const third = provider.reload().then(() => (settled += 1));
    await flush();
    expect(deps.fetch.mock.calls.length - before).toBe(1);

    rounds.shift()!();
    await flush();
    // 第一轮可能早于调用方刚做的改动发出：它结束后必须补拉一轮，且补拉完之前谁都不算完
    expect(deps.fetch.mock.calls.length - before).toBe(2);
    expect(settled).toBe(0);
    const renders = messages.filter((message) => message.type === 'render');
    expect(renders.at(-1)!.loading).toBe(true);

    rounds.shift()!();
    await Promise.all([first, second, third]);
    expect(deps.fetch.mock.calls.length - before).toBe(2);
    expect(settled).toBe(3);
    expect(messages.filter((message) => message.type === 'render').at(-1)!.loading).toBe(false);
  });

  it('starts_a_new_round_for_reloads_requested_right_after_the_last_round_finished', async () => {
    const { provider, deps } = await resolvedProvider();
    let release!: () => void;
    const pending = new Promise<undefined>((resolve) => (release = () => resolve(undefined)));
    deps.fetch.mockImplementationOnce(() => pending);
    const before = deps.fetch.mock.calls.length;

    const first = provider.reload();
    // 和这一轮的 fetch 在同一批微任务里兑现的调用方（同一段 stdout 里回来的归档响应）：
    // 它跑到时循环已经退出、不会再看补拉标记，必须另起一轮，不能拿到已经拉完的那一轮
    const second = pending.then(() => provider.reload());
    release();
    await Promise.all([first, second]);

    expect(deps.fetch.mock.calls.length - before).toBe(2);
  });

  it('keeps_reloading_after_a_fetch_that_throws_synchronously', async () => {
    const { provider, deps, lastRender } = await resolvedProvider();
    deps.fetch.mockImplementationOnce(() => {
      throw new Error('client disposed');
    });
    const before = deps.fetch.mock.calls.length;

    await provider.reload();
    expect(lastRender()!.error).toBe('client disposed');

    // 那一轮整个同步跑完：不能留下“还在拉”的状态，把后面的请求都并进去
    await provider.reload();
    expect(deps.fetch.mock.calls.length - before).toBe(2);
    expect(lastRender()!.error).toBeNull();
  });

  it('skips_renders_and_time_ticks_while_hidden_and_catches_up_when_visible', async () => {
    const { provider, messages, send, setVisible, lastRender } = await resolvedProvider();

    await setVisible(false);
    const posted = messages.length;
    // 标签切换、运行状态变化都会走 refresh；retainContextWhenHidden 下 webview 还活着，
    // 但重绘没人看
    provider.refresh();
    provider.setFilter('登录');
    await send({ type: 'tick' });
    expect(messages.length).toBe(posted);

    await setVisible(true);
    expect(messages.length).toBe(posted + 1);
    expect(lastRender()!.filter).toBe('登录');

    // 隐藏期间什么都没变：切回来只把相对时间刷到现在，不整页重绘
    await setVisible(false);
    await setVisible(true);
    expect(messages.length).toBe(posted + 2);
    expect(messages.at(-1)!.type).toBe('times');
  });

  it('defers_background_reloads_until_the_view_is_visible_again', async () => {
    const { provider, deps, setVisible } = await resolvedProvider();
    expect(deps.fetch).toHaveBeenCalledTimes(1);

    await setVisible(false);
    provider.reloadWhenVisible();
    provider.reloadWhenVisible();
    await flush();
    expect(deps.fetch).toHaveBeenCalledTimes(1);

    // 隐藏期间错过的几次定时刷新，切回来时合成一次补拉
    await setVisible(true);
    expect(deps.fetch).toHaveBeenCalledTimes(2);

    provider.reloadWhenVisible();
    await flush();
    expect(deps.fetch).toHaveBeenCalledTimes(3);
  });

  it('reports_visibility_changes_to_listeners', async () => {
    const provider = createSessionWebviewProvider({
      assets,
      fetch: vi.fn(async () => undefined),
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
    });
    const seen: boolean[] = [];
    provider.onDidChangeVisibility((visible) => seen.push(visible));
    // 还没解析过的视图不在屏幕上
    expect(provider.isVisible()).toBe(false);

    const fake = makeView();
    provider.resolveWebviewView(fake.view as never);
    await fake.setVisible(false);
    await fake.setVisible(false);
    await fake.setVisible(true);

    expect(seen).toEqual([true, false, true]);
    expect(provider.isVisible()).toBe(true);
  });
});
