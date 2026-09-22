import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../../src/extension';
import type { UriLike } from '../../src/codex/types';
import { PIN_STATE_KEY } from '../../src/session/pinStore';
import {
  createFakeChildProcess,
  createFakeMemento,
  createFakeUriApi,
  makeThread,
  pushMessage,
  type FakeChildProcess,
} from '../helpers/fakes';

// app-server 子进程必须被替换：真实 spawn 会拉起 Codex 自带的二进制。这个假进程
// 由测试逐条回包（先 initialize 握手，再业务方法），形状与 appServerClient.test.ts 一致。
// 每次 spawn 都给一个新假进程：「新建会话」会额外起一个一次性 app-server。
const spawnedChildren = vi.hoisted(() => ({ list: [] as FakeChildProcess[] }));
vi.mock('node:child_process', async () => {
  const { createFakeChildProcess } = await import('../helpers/fakes');
  return {
    spawn: () => {
      const child = createFakeChildProcess(4000 + spawnedChildren.list.length);
      spawnedChildren.list.push(child);
      return child;
    },
    __child: () => spawnedChildren.list[0],
    __children: () => spawnedChildren.list,
  };
});

// 归档/取消归档/删除的预检用的是同一份 /proc 归属扫描。测试里换成可控结果，
// 免得依赖真实进程；默认「没人持有」，需要时用例自己填。
const heldRollouts = vi.hoisted(() => ({ current: new Map<string, number>() }));
vi.mock('../../src/session/processScan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/session/processScan')>();
  return { ...actual, scanHeldRollouts: () => heldRollouts.current };
});

const uriApi = createFakeUriApi();
const flush = () => new Promise((resolve) => setImmediate(resolve));

let refreshes = 0;

/** `activate()` 需要的最小 ExtensionContext（只用到 globalState / subscriptions / 版本号）。 */
function makeContext() {
  return {
    globalState: createFakeMemento(),
    subscriptions: [] as unknown[],
    extension: { packageJSON: { version: '0.0.0-test' } },
  };
}

/** 观察「列表刷新」：树视图注册的 onDidChangeTreeData 监听器被触发几次。 */
function interceptTreeView(): void {
  (
    vscode.window.createTreeView as unknown as { mockImplementation(fn: unknown): void }
  ).mockImplementation(
    (
      _id: string,
      options: { treeDataProvider: { onDidChangeTreeData?: (listener: () => void) => unknown } },
    ) => {
      options.treeDataProvider.onDidChangeTreeData?.(() => {
        refreshes += 1;
      });
      return { dispose: vi.fn() };
    },
  );
}

/** 取出 `activate()` 注册的某个命令处理器（接线测试的入口）。 */
function activatedHandler(command: string): (node?: unknown) => Promise<unknown> {
  const register = vscode.commands.registerCommand as unknown as {
    mock: { calls: Array<[string, (node?: unknown) => Promise<unknown>]> };
  };
  const hit = register.mock.calls.find((call) => call[0] === command);
  if (!hit) throw new Error(`没有注册命令：${command}`);
  return hit[1];
}

async function appServerChild(): Promise<FakeChildProcess> {
  const mocked = (await import('node:child_process')) as unknown as {
    __children(): FakeChildProcess[];
  };
  const children = mocked.__children();
  // 取最后一个「还有没兑现的请求」的进程：共享 client 的握手失败后会重开进程，
  // 「新建会话」也会另起一个一次性进程，等待回包的那个才是当前真正在说话的。
  const waiting = children.filter((child) => child.written.length > 0);
  // 单独跑用例时可能还没人 spawn 过：兜底造一个（不登记进列表，免得被后续用例捡到）
  return waiting[waiting.length - 1] ?? children[children.length - 1] ?? createFakeChildProcess(9999);
}

async function appServerChildren(): Promise<FakeChildProcess[]> {
  const mocked = (await import('node:child_process')) as unknown as {
    __children(): FakeChildProcess[];
  };
  return mocked.__children();
}

/** 兑现某个假进程当前缓冲区里的每一条请求（按 method 给结果）。 */
async function answerChildRound(
  child: FakeChildProcess,
  results: Record<string, unknown> = {},
): Promise<Array<{ id: number; method: string; params?: unknown }>> {
  const requests: Array<{ id: number; method: string; params?: unknown }> = [];
  for (const line of child.written.splice(0)) {
    const request = JSON.parse(line) as { id: number; method: string; params?: unknown };
    requests.push(request);
    const result = request.method === 'initialize' ? { userAgent: 'codex/test' } : results[request.method] ?? {};
    pushMessage(child, { jsonrpc: '2.0', id: request.id, result });
  }
  await flush();
  return requests;
}

/** 把假进程收到的请求逐条兑现：initialize 回握手，其余按 outcome 回成功或失败。 */
async function answerAppServerRequests(outcome: 'ok' | 'fail'): Promise<void> {
  const child = await appServerChild();
  for (const line of child.written.splice(0)) {
    const request = JSON.parse(line) as { id: number; method: string };
    if (request.method === 'initialize') {
      pushMessage(child, { jsonrpc: '2.0', id: request.id, result: { userAgent: 'codex/test' } });
      continue;
    }
    pushMessage(
      child,
      outcome === 'ok'
        ? { jsonrpc: '2.0', id: request.id, result: {} }
        : { jsonrpc: '2.0', id: request.id, error: { code: -32600, message: 'app-server says no' } },
    );
  }
}

/** 跑一次命令处理器，中途替假的 app-server 回包（握手只发生在首个用例里）。 */
async function runHandler(
  handler: (node?: unknown) => Promise<unknown>,
  node: unknown,
  outcome: 'ok' | 'fail' = 'ok',
): Promise<unknown> {
  const pending = handler(node);
  await flush();
  await answerAppServerRequests(outcome);
  await flush();
  await answerAppServerRequests(outcome);
  return pending;
}

/** 构造一个 Codex 会话标签（input 是 fakes 里的 TabInputCustom）。 */
function makeTab(conversationId: string, label = `会话 ${conversationId}`) {
  return {
    label,
    input: new vscode.TabInputCustom(
      // 运行期是 fakes 的 TabInputCustom（吃 UriLike）；类型来自 @types/vscode（吃 Uri）
      uriApi
        .file(`/local/${conversationId}`)
        .with({ scheme: 'openai-codex', authority: 'route', query: '' }) as never,
      'chatgpt.conversationEditor',
    ),
  };
}

/** 抓到树数据提供者，好让用例自己触发一次 load（标题同步挂在 load 上）。 */
function captureTreeProvider(): { getChildren(node?: unknown): Promise<unknown> } {
  let captured: { getChildren(node?: unknown): Promise<unknown> } | undefined;
  (
    vscode.window.createTreeView as unknown as { mockImplementation(fn: unknown): void }
  ).mockImplementation(
    (_id: string, options: { treeDataProvider: { getChildren(node?: unknown): Promise<unknown> } }) => {
      captured = options.treeDataProvider;
      return { dispose: vi.fn() };
    },
  );
  activate(makeContext() as never);
  if (!captured) throw new Error('没有拿到树数据提供者');
  return captured;
}

/** 让假 app-server 满足一次完整 load：握手 + 两批 thread/list。 */
async function answerListRequests(threads: unknown[], archived: unknown[] = []): Promise<void> {
  const child = await appServerChild();
  const round = async (): Promise<void> => {
    for (const line of child.written.splice(0)) {
      const request = JSON.parse(line) as { id: number; method: string; params?: { archived?: boolean } };
      const result =
        request.method === 'initialize'
          ? { userAgent: 'codex/test' }
          : request.method === 'thread/list'
            ? { data: request.params?.archived ? archived : threads, nextCursor: null }
            : {};
      pushMessage(child, { jsonrpc: '2.0', id: request.id, result });
    }
    await flush();
  };
  await round();
  await round();
}

/** 让 `vscode.git` 扩展 API 返回一个带分支/远端的仓库。 */
function answerGitInfo(): void {
  (
    vscode.extensions.getExtension as unknown as { mockImplementation(fn: unknown): void }
  ).mockImplementation((id: string) =>
    id === 'vscode.git'
      ? {
          activate: async () => ({
            getAPI: () => ({
              getRepository: () => ({
                state: {
                  HEAD: { name: 'main', commit: 'abc123' },
                  remotes: [{ fetchUrl: 'git@example.com:o/r.git' }],
                },
              }),
            }),
          }),
        }
      : undefined,
  );
}

/** 让这一次 `showInputBox` 调用返回给定名字（once 语义，不泄漏到别的用例）。 */
function answerRenameWith(name: string): void {
  (
    vscode.window.showInputBox as unknown as { mockResolvedValueOnce(value: unknown): void }
  ).mockResolvedValueOnce(name);
}

describe('extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshes = 0;
    heldRollouts.current = new Map();
    // 共享的 app-server client 是模块级单例，跨用例复用；这里只重置外部状态
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    (vscode.window.tabGroups as { activeTabGroup: unknown }).activeTabGroup = { activeTab: undefined };
    // 让 `resolveCodexBinary` 直接返回配置值（否则它会因为「没有装 Codex 扩展」而抛错，
    // 命令根本走不到 app-server 调用）。
    (
      vscode.workspace.getConfiguration as unknown as { mockImplementation(fn: unknown): void }
    ).mockImplementation((section: string) => ({
      get: (key: string) =>
        section === 'codexHelper' && key === 'codexExecutable' ? '/tmp/fake-codex' : undefined,
    }));
  });

  // REQ: 会话打开与聚焦 / Scenario: 已打开的会话按它自己的标签 resource 打开（接线层）
  it('open_session_command_prefers_the_tab_resource', async () => {
    interceptTreeView();
    activate(makeContext() as never);

    const openSession = activatedHandler('codexHelper.openSession');
    const tabUri = uriApi
      .file('/local/conv-1')
      .with({ scheme: 'openai-codex', authority: 'route', query: 'projectId=p1' });

    await openSession({ sessionId: 'conv-1', tabUri, archived: false });

    // 必须原样把该标签自己的 resource 交给 openWith：重拼会丢掉 query，也就聚焦不到
    // 那个已经打开的标签（旧接线用 sessionId 重拼，生产日志里表现为新开一个标签）
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      tabUri,
      'chatgpt.conversationEditor',
      { preview: false },
    );
  });

  // REQ: 会话归档与删除 / Scenario: 预检命中「Codex 那侧持有」时连请求都不发（接线层）
  it('archive_precheck_blocks_the_request_when_codex_holds_the_thread', async () => {
    interceptTreeView();
    activate(makeContext() as never);
    heldRollouts.current = new Map([['t1', 30157]]);

    await activatedHandler('codexHelper.archiveSession')({ sessionId: 't1' });

    // 一次 app-server 往返都不该发生（那次往返必然被写者锁拒掉）
    const child = await appServerChild();
    const methods = child.written.map((line) => (JSON.parse(line) as { method: string }).method);
    expect(methods).not.toContain('thread/archive');
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    const message = String(
      (vscode.window.showErrorMessage as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0],
    );
    expect(message).toContain('无法归档这个会话');
    expect(refreshes).toBe(0);
  });

  // REQ: 会话归档与删除 / Scenario: 删除只关闭被删会话自己的标签
  it('delete_closes_only_the_matching_tab', async () => {
    interceptTreeView();
    activate(makeContext() as never);
    const doomed = makeTab('t1');
    const survivor = makeTab('t2');
    (vscode.window.tabGroups.all as unknown[]) = [{ tabs: [doomed, survivor] }];

    await runHandler(activatedHandler('codexHelper.deleteSession'), { sessionId: 't1' });

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(1);
    const closed = (vscode.window.tabGroups.close as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0];
    expect(closed).toEqual([doomed]);
    expect(refreshes).toBe(1);
  });

  // REQ: 会话重命名 / Scenario: 重命名成功后刷新列表（接线层）
  it('rename_refreshes_the_list_after_a_successful_write_back', async () => {
    interceptTreeView();
    activate(makeContext() as never);
    answerRenameWith('价格排查');

    await runHandler(activatedHandler('codexHelper.renameSession'), {
      sessionId: 't1',
      label: '旧名字',
    });

    // 新名字只在服务端：不刷新就一直是旧标题，用户得手动点刷新
    expect(refreshes).toBe(1);
  });

  // REQ: 会话重命名 / Scenario: 重命名失败时提示错误（失败不得刷新，否则是假成功）
  it('rename_failure_does_not_refresh_the_list', async () => {
    interceptTreeView();
    activate(makeContext() as never);
    answerRenameWith('价格排查');

    await runHandler(
      activatedHandler('codexHelper.renameSession'),
      { sessionId: 't1', label: '旧名字' },
      'fail',
    );

    expect(refreshes).toBe(0);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
  });

  // REQ: 会话重命名 / Scenario: 用户取消输入时不发请求（取消不刷新）
  it('rename_cancel_does_not_refresh_the_list', async () => {
    interceptTreeView();
    activate(makeContext() as never);

    await activatedHandler('codexHelper.renameSession')({ sessionId: 't1', label: '旧名字' });

    expect(refreshes).toBe(0);
  });

  // INV-004: 三条命令都不弹确认，且只有删除会关标签 / 只有成功才做清理
  it('destructive_actions_never_ask_and_only_delete_closes_tabs', async () => {
    const actions = [
      { command: 'codexHelper.archiveSession', closesTabs: false },
      { command: 'codexHelper.unarchiveSession', closesTabs: false },
      { command: 'codexHelper.deleteSession', closesTabs: true },
    ] as const;

    let checked = 0;
    let successCloseRuns = 0;

    for (const action of actions) {
      for (const outcome of ['ok', 'fail'] as const) {
        vi.clearAllMocks();
        refreshes = 0;
        interceptTreeView();
        const context = makeContext();
        await context.globalState.update(PIN_STATE_KEY, ['t1']);
        activate(context as never);
        (vscode.window.tabGroups.all as unknown[]) = [{ tabs: [makeTab('t1')] }];

        await runHandler(activatedHandler(action.command), { sessionId: 't1' }, outcome);

        const label = `${action.command}/${outcome}`;
        // 三条命令都不弹确认框（命令层的依赖里也没有确认入口）
        expect(vscode.window.showWarningMessage, `${label} 弹了确认框`).not.toHaveBeenCalled();

        const closeCalls = (vscode.window.tabGroups.close as unknown as { mock: { calls: unknown[][] } }).mock
          .calls.length;
        if (outcome === 'fail') {
          // 失败什么都不做：不关标签、不动置顶、不刷新
          expect(closeCalls, `${label} 失败却关了标签`).toBe(0);
          expect(context.globalState.get(PIN_STATE_KEY), `${label} 失败却改了置顶`).toEqual(['t1']);
          expect(refreshes, `${label} 失败却刷新了列表`).toBe(0);
        } else if (action.closesTabs) {
          expect(closeCalls, `${label} 删除成功应当关掉匹配标签`).toBe(1);
          expect(context.globalState.get(PIN_STATE_KEY), `${label} 删除后应清掉置顶`).toEqual([]);
          successCloseRuns += 1;
        } else {
          expect(closeCalls, `${label} 归档/取消归档不得关标签`).toBe(0);
          expect(refreshes, `${label} 成功应当刷新列表`).toBe(1);
        }
        checked += 1;
      }
    }

    expect(checked).toBe(6);
    // 反空转护栏：6 格里真的出现过「关标签」的那一格
    expect(successCloseRuns).toBe(1);
  });

  // REQ: 新建会话 / Scenario: 建会话成功后打开绑定标签
  it('new_session_command_creates_bound_session_with_one_shot_process', async () => {
    interceptTreeView();
    activate(makeContext() as never);
    answerGitInfo();
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [
      { uri: { ...uriApi.file('/repo'), fsPath: '/repo' } },
    ];

    const before = (await appServerChildren()).length;
    const pending = activatedHandler('codexHelper.newSession')();
    await flush();

    const children = await appServerChildren();
    // 恰好新起一个进程：共享的那个 app-server 不能被用来落盘（它会一直持有 writer 锁）
    expect(children.length - before).toBe(1);
    const oneShot = children[before]!;
    const requests = [
      ...(await answerChildRound(oneShot)),
      // 每次回包之后才写下一个请求：一轮一个
      ...(await answerChildRound(oneShot, { 'thread/start': { thread: { id: 'tid-1' } } })),
      ...(await answerChildRound(oneShot, { 'thread/metadata/update': {} })),
      ...(await answerChildRound(oneShot, { 'thread/resume': {} })),
    ];
    await pending;

    // 建会话的调用序列就是本机 probe 出来的那条（少了 metadata/update 面板打不开）
    expect(requests.map((request) => request.method)).toEqual([
      'initialize',
      'thread/start',
      'thread/metadata/update',
      'thread/resume',
    ]);
    expect(requests[1]!.params).toEqual({ cwd: '/repo' });
    expect(requests[2]!.params).toEqual({
      threadId: 'tid-1',
      gitInfo: { branch: 'main', sha: 'abc123', originUrl: 'git@example.com:o/r.git' },
    });
    // 一次性进程必须死掉：它活着就持有 writer 锁，Codex 面板 resume 会被拒
    expect(oneShot.killed).toBe(true);

    const [command, uri] = (
      vscode.commands.executeCommand as unknown as { mock: { calls: Array<[string, UriLike]> } }
    ).mock.calls[0]!;
    expect(command).toBe('vscode.openWith');
    expect(uri.path).toBe('/local/tid-1');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  // REQ: 未标题标签的标题同步 / Scenario: 未标题标签被同步成会话标题（接线层）
  it('title_sync_reopens_untitled_tab_of_an_idle_session', async () => {
    const provider = captureTreeProvider();
    const tab = makeTab('t1', 'Codex');
    (vscode.window.tabGroups.all as unknown[]) = [{ tabs: [tab] }];

    const loading = provider.getChildren();
    await flush();
    await answerListRequests([makeThread({ id: 't1', name: '修复登录超时' })]);
    await loading;
    await flush();

    // 关掉标题还停在 Codex 的标签，再用它**自己的 resource** 重开 —— 这是让 Codex
    // 重新 resolve 并自己写标题的唯一手段
    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(1);
    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(tab, true);
    const openCall = (
      vscode.commands.executeCommand as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.find((call) => call[0] === 'vscode.openWith')!;
    expect((openCall[1] as UriLike).path).toBe('/local/t1');
    expect(openCall[3]).toEqual({ preview: false });
  });

  // REQ: 新建会话 / Scenario: 非 git 工作区仍然建会话并打开绑定标签
  it('new_session_still_binds_in_a_non_git_workspace', async () => {
    interceptTreeView();
    activate(makeContext() as never);
    // 既没有 vscode.git，也没有 Codex 扩展：探测不到任何真实 git 信息
    (
      vscode.extensions.getExtension as unknown as { mockImplementation(fn: unknown): void }
    ).mockImplementation(() => undefined);
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [
      { uri: { ...uriApi.file('/tmp/not-a-repo'), fsPath: '/tmp/not-a-repo' } },
    ];

    const before = (await appServerChildren()).length;
    const pending = activatedHandler('codexHelper.newSession')();
    await flush();
    const oneShot = (await appServerChildren())[before]!;
    const requests = [
      ...(await answerChildRound(oneShot)),
      ...(await answerChildRound(oneShot, { 'thread/start': { thread: { id: 'tid-nogit' } } })),
      ...(await answerChildRound(oneShot, { 'thread/metadata/update': {} })),
      ...(await answerChildRound(oneShot, { 'thread/resume': {} })),
    ];
    await pending;

    // 「这个目录不是 git 仓库」不该让新建会话退化：写全零 sha 占位照样能落盘，
    // 而 Codex 前端只读 branch/originUrl，占位在界面上看不见。
    expect(requests[2]!.params).toEqual({
      threadId: 'tid-nogit',
      gitInfo: { sha: '0'.repeat(40) },
    });
    const [command, uri] = (
      vscode.commands.executeCommand as unknown as { mock: { calls: Array<[string, UriLike]> } }
    ).mock.calls[0]!;
    expect(command).toBe('vscode.openWith');
    expect(uri.path).toBe('/local/tid-nogit');
  });
});
