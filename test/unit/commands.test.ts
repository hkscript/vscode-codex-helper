import { describe, expect, it, vi } from 'vitest';
import { createNewSessionCommand, createRenameSessionCommand } from '../../src/commands';

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

  // REQ: 新建会话 / Scenario: 执行命令时调用 Codex 的新建面板命令
  it('calls_new_codex_panel_once', async () => {
    const calls: unknown[][] = [];
    const executeCommand = vi.fn(async (command: string, ...args: unknown[]) => {
      calls.push([command, ...args]);
    });
    const showErrorMessage = vi.fn((_message: string) => undefined);
    const newSession = createNewSessionCommand({ executeCommand, showErrorMessage });

    await newSession();

    // 委派给 Codex 自己的新建入口；多传参数会踩到它内部的推广分支（design D12）
    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual(['chatgpt.newCodexPanel']);
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  // REQ: 新建会话 / Scenario: 新建失败时提示错误
  it('shows_error_when_new_session_command_fails', async () => {
    const executeCommand = vi.fn(async (_command: string, ..._args: unknown[]) => {
      throw new Error("command 'chatgpt.newCodexPanel' not found");
    });
    const showErrorMessage = vi.fn((_message: string) => undefined);
    const newSession = createNewSessionCommand({ executeCommand, showErrorMessage });

    // 命令本身不能把异常抛回 VS Code 命令层，否则用户只看到静默失败
    await expect(newSession()).resolves.toBeUndefined();

    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('not found');
  });
});
