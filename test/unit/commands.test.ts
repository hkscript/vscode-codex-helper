import { describe, expect, it, vi } from 'vitest';
import { createNewSessionCommand, createRenameSessionCommand } from '../../src/commands';
import type { UriLike } from '../../src/codex/types';
import { createFakeUriApi } from '../helpers/fakes';

function makeDeps(options: {
  answer?: string | undefined;
  failWith?: Error;
}) {
  const renames: Array<{ threadId: string; name: string }> = [];
  const showInputBox = vi.fn(async (_options?: unknown) => options.answer);
  const showErrorMessage = vi.fn((_message: string) => undefined);
  const threadApi = {
    setThreadName: vi.fn(async (threadId: string, name: string) => {
      if (options.failWith) throw options.failWith;
      renames.push({ threadId, name });
    }),
  };
  return { deps: { threadApi, showInputBox, showErrorMessage }, renames, showInputBox, showErrorMessage };
}

function makeNewSessionDeps() {
  const calls: unknown[][] = [];
  const executeCommand = vi.fn(async (command: string, ...args: unknown[]) => {
    calls.push([command, ...args]);
  });
  const showErrorMessage = vi.fn((_message: string) => undefined);
  const nonces = ['n1', 'n2'];
  const createNonce = vi.fn(() => nonces.shift() ?? 'nX');
  return {
    deps: { executeCommand, showErrorMessage, uriApi: createFakeUriApi(), createNonce },
    calls,
    executeCommand,
    showErrorMessage,
    createNonce,
  };
}

/** VS Code 的 resource 身份：scheme/authority/path/query 全同才算同一个文档。 */
function resourceKey(uri: UriLike): string {
  return `${uri.scheme}://${uri.authority}${uri.path}?${uri.query}`;
}

describe('commands', () => {
  it('sets_thread_name_on_rename', async () => {
    const { deps, renames, showInputBox } = makeDeps({ answer: '价格排查' });
    const renameSession = createRenameSessionCommand(deps);

    await renameSession({ sessionId: 't1', label: '旧名字' });

    expect(showInputBox).toHaveBeenCalledTimes(1);
    // 名字写回 Codex（不是本地别名），TUI 与插件都能看到
    expect(renames).toEqual([{ threadId: 't1', name: '价格排查' }]);
  });

  it('skips_rpc_when_rename_cancelled', async () => {
    const { deps, showErrorMessage } = makeDeps({ answer: undefined });
    const renameSession = createRenameSessionCommand(deps);

    await renameSession({ sessionId: 't1', label: '旧名字' });

    expect(deps.threadApi.setThreadName).not.toHaveBeenCalled();
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it('shows_error_when_rename_fails', async () => {
    const { deps, showErrorMessage } = makeDeps({
      answer: '价格排查',
      failWith: new Error('thread/name/set failed: rpc error'),
    });
    const renameSession = createRenameSessionCommand(deps);

    // 命令本身不能把异常抛回 VS Code 命令层，否则用户只看到静默失败
    await expect(renameSession({ sessionId: 't1', label: '旧名字' })).resolves.toBeUndefined();

    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('rpc error');
  });

  // REQ: 新建会话 / Scenario: 每次执行都打开带上本次调用独有 query 的新面板 URI
  it('opens_new_panel_uri_with_injected_nonce', async () => {
    const { deps, calls, executeCommand, showErrorMessage } = makeNewSessionDeps();
    const newSession = createNewSessionCommand(deps);

    await newSession();

    expect(executeCommand).toHaveBeenCalledTimes(1);
    const [command, uri, viewType, options] = calls[0] as [string, UriLike, string, unknown];
    expect(command).toBe('vscode.openWith');
    expect(resourceKey(uri)).toBe('openai-codex://route/extension/panel/new?newPanel=n1');
    expect(viewType).toBe('chatgpt.conversationEditor');
    expect(options).toEqual({ preview: false });
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  // REQ: 新建会话 / Scenario: 连续两次执行产生两个互不相同的 URI
  it('two_invocations_open_two_distinct_uris', async () => {
    const { deps, calls, createNonce } = makeNewSessionDeps();
    const newSession = createNewSessionCommand(deps);

    await newSession();
    await newSession();

    expect(createNonce).toHaveBeenCalledTimes(2);
    const uris = calls.map((call) => call[1] as UriLike);
    // 关键断言：两次点击必须落到两个 resource，否则 VS Code 只会保留一个标签
    expect(uris.map(resourceKey)).toEqual([
      'openai-codex://route/extension/panel/new?newPanel=n1',
      'openai-codex://route/extension/panel/new?newPanel=n2',
    ]);
    expect(new Set(uris.map(resourceKey)).size).toBe(2);
    // 路由 path 不变，webview 才匹配得上
    expect(uris.map((uri) => uri.path)).toEqual(['/extension/panel/new', '/extension/panel/new']);
    // 不再委派给只能开一个的入口
    expect(calls.some((call) => call[0] === 'chatgpt.newCodexPanel')).toBe(false);
  });

  // REQ: 新建会话 / Scenario: 新建失败时提示错误
  it('shows_error_when_new_panel_open_fails', async () => {
    const { deps, showErrorMessage } = makeNewSessionDeps();
    // 只有 vscode.openWith 这条路径会抛错；旧实现委派的是 chatgpt.newCodexPanel，
    // 因此这条断言具备失败能力（scenario 的 GIVEN 就是「openWith 抛出错误」）。
    deps.executeCommand.mockImplementation(async (command: string) => {
      if (command !== 'vscode.openWith') return;
      throw new Error('no custom editor registered for chatgpt.conversationEditor');
    });
    const newSession = createNewSessionCommand(deps);

    // 命令本身不能把异常抛回 VS Code 命令层，否则用户只看到静默失败
    await expect(newSession()).resolves.toBeUndefined();

    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('no custom editor registered');
  });
});
