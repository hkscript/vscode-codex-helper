import { describe, expect, it, vi } from 'vitest';
import {
  PLACEHOLDER_GIT_INFO,
  createBoundSession,
  waitForChildExit,
} from '../../src/session/sessionCreator';
import { createFakeChildProcess } from '../helpers/fakes';

/**
 * 一次性 app-server 的建会话水线。调用序列是本机 probe 出来的：
 *   thread/start → thread/metadata/update {gitInfo} → thread/resume
 * 少了 metadata/update，resume 会报 `no rollout found`（rollout 没落盘）。
 */
interface FakeClient {
  start(): Promise<unknown>;
  request<T>(method: string, params?: unknown): Promise<T>;
  calls: Array<{ method: string; params: unknown }>;
}

function makeClient(
  respond: (method: string, params: unknown) => unknown = () => ({}),
): FakeClient {
  const calls: FakeClient['calls'] = [];
  const client: FakeClient = {
    calls,
    async start() {
      calls.push({ method: 'initialize', params: undefined });
      return {};
    },
    async request<T>(method: string, params?: unknown): Promise<T> {
      calls.push({ method, params });
      return respond(method, params) as T;
    },
  };
  return client;
}

const gitInfo = { branch: 'main', sha: 'abc123', originUrl: 'git@example.com:o/r.git' };

describe('sessionCreator', () => {
  // REQ: 新建会话 / Scenario: 建会话成功后打开绑定标签
  it('creates_session_then_materializes_rollout_with_git_info', async () => {
    const client = makeClient((method) =>
      method === 'thread/start' ? { thread: { id: 'thread-1' } } : {},
    );

    const id = await createBoundSession(client, { cwd: '/repo', gitInfo });

    expect(id).toBe('thread-1');
    expect(client.calls.map((call) => call.method)).toEqual([
      'initialize',
      'thread/start',
      'thread/metadata/update',
      'thread/resume',
    ]);
    expect(client.calls[1]!.params).toEqual({ cwd: '/repo' });
    // gitInfo 必须是真实探测到的字段：它是让 Codex 落盘的唯一非破坏性触发器
    expect(client.calls[2]!.params).toEqual({ threadId: 'thread-1', gitInfo });
    expect(client.calls[3]!.params).toEqual({ threadId: 'thread-1' });
  });

  it('omits_cwd_when_the_workspace_has_none', async () => {
    const client = makeClient(() => ({ thread: { id: 'thread-2' } }));

    await createBoundSession(client, { cwd: null, gitInfo });

    expect(client.calls[1]!.params).toEqual({});
  });

  it('returns_null_and_stops_when_start_fails', async () => {
    const client = makeClient((method) => {
      if (method === 'thread/start') throw new Error('thread/start failed: boom');
      return {};
    });

    await expect(createBoundSession(client, { cwd: '/repo', gitInfo })).resolves.toBeNull();
    expect(client.calls.map((call) => call.method)).toEqual(['initialize', 'thread/start']);
  });

  it('returns_null_when_start_has_no_thread_id', async () => {
    const client = makeClient(() => ({ thread: {} }));

    await expect(createBoundSession(client, { cwd: '/repo', gitInfo })).resolves.toBeNull();
    expect(client.calls.map((call) => call.method)).toEqual(['initialize', 'thread/start']);
  });

  it('returns_null_without_any_request_when_git_info_is_empty', async () => {
    const client = makeClient(() => ({ thread: { id: 'thread-3' } }));

    // 没有 gitInfo 就落不了盘：宁可不建，也不要建出一个面板打不开的空会话
    await expect(createBoundSession(client, { cwd: '/repo', gitInfo: null })).resolves.toBeNull();
    expect(client.calls).toEqual([]);
  });

  it('placeholder_git_info_is_a_non_empty_sha_so_codex_can_persist', async () => {
    // 非 git 目录靠这个占位值落盘：它必须至少有一个字段（否则 app-server 直接拒），
    // 又必须不写分支名（Codex 前端会把 branch 显示出来），所以只能是全零 sha。
    expect(PLACEHOLDER_GIT_INFO).toEqual({ sha: '0'.repeat(40) });

    const client = makeClient(() => ({ thread: { id: 'thread-6' } }));
    await createBoundSession(client, { cwd: '/tmp/not-a-repo', gitInfo: PLACEHOLDER_GIT_INFO });
    expect(client.calls[2]!.params).toEqual({
      threadId: 'thread-6',
      gitInfo: { sha: '0'.repeat(40) },
    });
  });

  it('returns_null_when_metadata_update_fails', async () => {
    const client = makeClient((method) => {
      if (method === 'thread/metadata/update') throw new Error('metadata failed');
      return { thread: { id: 'thread-4' } };
    });

    await expect(createBoundSession(client, { cwd: '/repo', gitInfo })).resolves.toBeNull();
    expect(client.calls.map((call) => call.method)).toEqual([
      'initialize',
      'thread/start',
      'thread/metadata/update',
    ]);
  });

  it('returns_null_when_resume_fails', async () => {
    const client = makeClient((method) => {
      if (method === 'thread/resume') throw new Error('no rollout found');
      return { thread: { id: 'thread-5' } };
    });

    await expect(createBoundSession(client, { cwd: '/repo', gitInfo })).resolves.toBeNull();
  });

  // REQ: 新建会话 / Scenario: 落盘后必须等子进程退出才打开标签
  it('waits_for_child_exit_and_gives_up_after_timeout', async () => {
    const exiting = createFakeChildProcess();
    const exited = waitForChildExit(exiting, 1_000);
    exiting.emit('exit', 0, 'SIGTERM');
    await expect(exited).resolves.toBeUndefined();

    // 进程赖着不走时也不能把命令卡死：超时就放行（锁可能还在，但总比卡住强）
    const silent = createFakeChildProcess();
    await expect(waitForChildExit(silent, 20)).resolves.toBeUndefined();
    await expect(waitForChildExit(null, 20)).resolves.toBeUndefined();
  });
});
