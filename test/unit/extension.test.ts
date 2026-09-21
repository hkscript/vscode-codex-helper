import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../../src/extension';
import { PIN_STATE_KEY } from '../../src/session/pinStore';
import { createFakeMemento, createFakeUriApi, pushMessage, type FakeChildProcess } from '../helpers/fakes';

// app-server 子进程必须被替换：真实 spawn 会拉起 Codex 自带的二进制。这个假进程
// 由测试逐条回包（先 initialize 握手，再业务方法），形状与 appServerClient.test.ts 一致。
vi.mock('node:child_process', async () => {
  const { createFakeChildProcess } = await import('../helpers/fakes');
  const child = createFakeChildProcess();
  return { spawn: () => child, __child: () => child };
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
  const mocked = (await import('node:child_process')) as unknown as { __child(): FakeChildProcess };
  return mocked.__child();
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
function makeTab(conversationId: string) {
  return {
    label: `会话 ${conversationId}`,
    input: new vscode.TabInputCustom(
      // 运行期是 fakes 的 TabInputCustom（吃 UriLike）；类型来自 @types/vscode（吃 Uri）
      uriApi
        .file(`/local/${conversationId}`)
        .with({ scheme: 'openai-codex', authority: 'route', query: '' }) as never,
      'chatgpt.conversationEditor',
    ),
  };
}

describe('extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshes = 0;
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
});
