import { describe, expect, it, vi } from 'vitest';
import {
  createArchiveSessionCommand,
  createDeleteSessionCommand,
  createNewSessionCommand,
  createRenameSessionCommand,
  createUnarchiveSessionCommand,
} from '../../src/commands';
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
  /** 三个会话动作命令共用：记录 RPC、可注入失败、记录错误提示。 */
  function makeSessionActionDeps(options: { failWith?: Error } = {}) {
    const calls: Array<{ method: string; threadId: string }> = [];
    const record = (method: string) =>
      vi.fn(async (threadId: string) => {
        if (options.failWith) throw options.failWith;
        calls.push({ method, threadId });
      });
    const showErrorMessage = vi.fn((_message: string) => undefined);
    return {
      deps: {
        threadApi: {
          archiveThread: record('archiveThread'),
          unarchiveThread: record('unarchiveThread'),
          deleteThread: record('deleteThread'),
        },
        showErrorMessage,
      },
      calls,
      showErrorMessage,
    };
  }

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

  // REQ: 会话归档与删除 / Scenario: 归档不弹确认直接执行（命令层）
  it('archives_session_without_confirmation', async () => {
    const { deps, calls, showErrorMessage } = makeSessionActionDeps();
    const archiveSession = createArchiveSessionCommand(deps);

    await expect(archiveSession({ sessionId: 't1' })).resolves.toBe(true);

    expect(calls).toEqual([{ method: 'archiveThread', threadId: 't1' }]);
    // 归档可逆 ⇒ 不弹确认；命令依赖里也没有任何确认/输入入口
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  // REQ: 会话归档与删除 / Scenario: 删除已归档会话不弹确认直接执行（命令层）
  it('deletes_archived_session_without_confirmation', async () => {
    const { deps, calls, showErrorMessage } = makeSessionActionDeps();
    const deleteSession = createDeleteSessionCommand(deps);

    await expect(deleteSession({ sessionId: 't1' })).resolves.toBe(true);

    // 删除只对已归档条目开放（菜单层限制），命令本身不弹确认、直接执行
    expect(calls).toEqual([{ method: 'deleteThread', threadId: 't1' }]);
    expect(showErrorMessage).not.toHaveBeenCalled();

    // 没有会话 id 时不发请求（右键菜单在某些位置会传空节点）
    await expect(deleteSession(undefined)).resolves.toBe(false);
    expect(calls).toHaveLength(1);
  });

  // REQ: 会话归档与删除 / Scenario: 取消归档（命令层）
  it('unarchives_session', async () => {
    const { deps, calls, showErrorMessage } = makeSessionActionDeps();
    const unarchiveSession = createUnarchiveSessionCommand(deps);

    await expect(unarchiveSession({ sessionId: 't1' })).resolves.toBe(true);

    expect(calls).toEqual([{ method: 'unarchiveThread', threadId: 't1' }]);
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  // REQ: 会话归档与删除 / Scenario: 写者锁在 Codex 那侧时如实说明，不做假补救
  it('explains_the_codex_side_writer_lock_instead_of_guessing', async () => {
    const { deps, calls, showErrorMessage } = makeSessionActionDeps({
      failWith: new Error('thread t1 already has an active writer'),
    });
    const archiveSession = createArchiveSessionCommand(deps);

    await expect(archiveSession({ sessionId: 't1' })).resolves.toBe(false);

    expect(calls).toEqual([]);
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    const message = String(showErrorMessage.mock.calls[0]![0]);
    // 结论：跨进程拿不到锁，只能换入口或让 Codex 那侧的 app-server 退出
    expect(message).toContain('被 Codex 那侧的 app-server 持有');
    expect(message).toContain('Reload Window');
  });

  // 反空转护栏：这条文案只能出现在写者锁这一种失败上
  it('keeps_other_failures_verbatim', async () => {
    const { deps, showErrorMessage } = makeSessionActionDeps({
      failWith: new Error('thread not found: t1'),
    });
    const archiveSession = createArchiveSessionCommand(deps);

    await expect(archiveSession({ sessionId: 't1' })).resolves.toBe(false);

    const message = String(showErrorMessage.mock.calls[0]![0]);
    expect(message).toContain('thread not found: t1');
    expect(message).not.toContain('Reload Window');
  });

  // REQ: 会话归档与删除 / Scenario: 归档失败时报错且不改变本地状态
  it('shows_error_when_archive_fails', async () => {
    const { deps, calls, showErrorMessage } = makeSessionActionDeps({
      failWith: new Error('thread not found'),
    });
    const archiveSession = createArchiveSessionCommand(deps);

    // 失败 ⇒ 返回「没做成」，调用方据此不做任何清理
    await expect(archiveSession({ sessionId: 't1' })).resolves.toBe(false);

    expect(calls).toEqual([]);
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('归档会话失败');
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('thread not found');
  });

  // REQ: 会话归档与删除 / Scenario: 删除失败时报错且不改变本地状态
  it('shows_error_when_delete_fails', async () => {
    const { deps, calls, showErrorMessage } = makeSessionActionDeps({
      failWith: new Error('invalid thread id'),
    });
    const deleteSession = createDeleteSessionCommand(deps);

    await expect(deleteSession({ sessionId: 't1' })).resolves.toBe(false);

    expect(calls).toEqual([]);
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('删除会话失败');
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('invalid thread id');
  });
});
