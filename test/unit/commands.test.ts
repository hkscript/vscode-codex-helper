import { describe, expect, it, vi } from 'vitest';
import {
  createArchiveSessionCommand,
  createDeleteSessionCommand,
  createNewSessionCommand,
  createRenameSessionCommand,
  createUnarchiveSessionCommand,
} from '../../src/commands';

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

/**
 * 「新建会话」的依赖：记录事件顺序，用来钉死「先建会话、再打开它」这条顺序不变量。
 * `openConversation` / `discardThread` 的结果可注入，覆盖失败分支。
 */
function makeNewSessionDeps(options: {
  startFails?: Error;
  openFails?: boolean;
  discardFails?: Error;
  threadId?: string;
} = {}) {
  const threadId = options.threadId ?? 't-new';
  const events: string[] = [];
  const startThread = vi.fn(async () => {
    if (options.startFails) throw options.startFails;
    events.push('start');
    return threadId;
  });
  const openConversation = vi.fn(async (id: string) => {
    events.push(`open:${id}`);
    return options.openFails !== true;
  });
  const discardThread = vi.fn(async (id: string) => {
    events.push(`discard:${id}`);
    if (options.discardFails) throw options.discardFails;
  });
  const showErrorMessage = vi.fn((_message: string) => undefined);
  return {
    deps: { startThread, openConversation, discardThread, showErrorMessage },
    events,
    startThread,
    openConversation,
    discardThread,
    showErrorMessage,
  };
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

  // REQ: 新建会话 / Scenario: 先建会话再按会话 id 打开
  it('creates_a_thread_and_then_opens_that_conversation', async () => {
    const { deps, events, showErrorMessage } = makeNewSessionDeps({ threadId: 't-new' });
    const newSession = createNewSessionCommand(deps);

    await newSession();

    // 顺序不变量：没有会话 id 就没有可打开的标签（旧实现先开空白面板，标签与会话脱钩）
    expect(events).toEqual(['start', 'open:t-new']);
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  // REQ: 新建会话 / Scenario: 连续两次执行各自建一个会话
  it('each_invocation_creates_its_own_thread', async () => {
    const { deps, openConversation } = makeNewSessionDeps();
    let counter = 0;
    deps.startThread.mockImplementation(async () => `t-${++counter}`);
    const newSession = createNewSessionCommand(deps);

    await newSession();
    await newSession();

    expect(openConversation.mock.calls.map((call) => call[0])).toEqual(['t-1', 't-2']);
  });

  // REQ: 新建会话 / Scenario: 建会话失败时提示错误
  it('shows_error_when_thread_start_fails', async () => {
    const { deps, events, showErrorMessage } = makeNewSessionDeps({
      startFails: new Error('thread/start failed: app-server exited'),
    });
    const newSession = createNewSessionCommand(deps);

    // 命令本身不能把异常抛回 VS Code 命令层，否则用户只看到静默失败
    await expect(newSession()).resolves.toBeUndefined();

    expect(events).toEqual([]);
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('新建会话失败');
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('app-server exited');
  });

  // REQ: 新建会话 / Scenario: 会话建好但打开失败时删掉它，且不重复报错
  it('discards_the_thread_when_opening_fails', async () => {
    const { deps, events, showErrorMessage } = makeNewSessionDeps({
      threadId: 't-orphan',
      openFails: true,
    });
    const newSession = createNewSessionCommand(deps);

    await expect(newSession()).resolves.toBeUndefined();

    expect(events).toEqual(['start', 'open:t-orphan', 'discard:t-orphan']);
    // 「打不开」的原因由 opener 报，命令层不叠加第二条错误
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  // REQ: 新建会话 / Scenario: 清理失败不再叠加错误
  it('keeps_quiet_when_discard_fails', async () => {
    const { deps, showErrorMessage } = makeNewSessionDeps({
      openFails: true,
      discardFails: new Error('thread/delete failed: thread not loaded'),
    });
    const newSession = createNewSessionCommand(deps);

    await expect(newSession()).resolves.toBeUndefined();

    expect(showErrorMessage).not.toHaveBeenCalled();
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
