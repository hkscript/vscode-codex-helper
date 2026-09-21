import { describe, expect, it } from 'vitest';
import { CLIENT_NAME, createAppServerClient } from '../../src/codex/appServerClient';
import { createFakeSpawn, pushMessage } from '../helpers/fakes';

function setup(requestTimeoutMs = 100) {
  const fake = createFakeSpawn();
  const client = createAppServerClient({
    binaryPath: '/ext/openai.chatgpt/bin/linux-x86_64/codex',
    spawn: fake.spawn as never,
    requestTimeoutMs,
    // 版本由调用方给（生产里取自 package.json），这里用假版本，
    // 这样发版不需要动测试
    clientInfo: { name: CLIENT_NAME, version: '9.9.9' },
  });
  return { fake, client };
}

async function started(requestTimeoutMs = 100) {
  const { fake, client } = setup(requestTimeoutMs);
  const ready = client.start();
  const child = fake.children[0]!;
  pushMessage(child, { id: 1, result: { userAgent: 'codex/0.0.0' } });
  await ready;
  return { fake, client, child };
}

describe('appServerClient', () => {
  // REQ: 会话归档与删除 / Scenario: 预检要知道「持有者是不是我们自己」
  it('exposes_the_child_pid_for_ownership_checks', async () => {
    const { client, child } = await started();

    expect(client.pid()).toBe(child.pid);

    client.dispose();
    expect(client.pid()).toBeUndefined();
  });

  it('sends_initialize_as_first_message', () => {
    const { fake, client } = setup();
    const ready = client.start();
    const child = fake.children[0]!;

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.command).toBe('/ext/openai.chatgpt/bin/linux-x86_64/codex');
    expect(fake.calls[0]!.args).toEqual(['app-server']);
    expect(fake.calls[0]!.options).toEqual({ stdio: ['pipe', 'pipe', 'pipe'] });

    const first = JSON.parse(child.written[0]!.trim());
    expect(first.method).toBe('initialize');
    expect(first.id).toBe(1);
    // 客户端只负责原样转发 clientInfo；名字是稳定标识，改掉要付一次断言的代价
    expect(first.params).toEqual({ clientInfo: { name: 'vscode-codex-helper', version: '9.9.9' } });

    pushMessage(child, { id: 1, result: { userAgent: 'codex/0.0.0' } });
    return expect(ready).resolves.toEqual({ userAgent: 'codex/0.0.0' });
  });

  it('reassembles_message_split_across_chunks', async () => {
    const { client, child } = await started();

    const pending = client.request<{ data: string[] }>('thread/loaded/list');
    const line = JSON.stringify({ id: 2, result: { data: ['t1'] } });
    child.pushStdout(line.slice(0, 10));
    child.pushStdout(line.slice(10, 25));
    child.pushStdout(`${line.slice(25)}\n`);

    await expect(pending).resolves.toEqual({ data: ['t1'] });
  });

  it('dispatches_multiple_messages_in_one_chunk', async () => {
    const { client, child } = await started();

    const first = client.request('thread/list');
    const second = client.request('thread/loaded/list');
    child.pushStdout(
      `${JSON.stringify({ id: 2, result: { data: [{ id: 'a' }] } })}\n` +
        `${JSON.stringify({ id: 3, result: { data: ['a'] } })}\n`,
    );

    await expect(first).resolves.toEqual({ data: [{ id: 'a' }] });
    await expect(second).resolves.toEqual({ data: ['a'] });
  });

  it('ignores_notifications_without_id', async () => {
    const { client, child } = await started();

    const pending = client.request('thread/list');
    child.pushStdout(`${JSON.stringify({ method: 'configWarning', params: { message: 'hi' } })}\n`);
    child.pushStdout(`${JSON.stringify({ method: 'remoteControl/status/changed', params: {} })}\n`);
    expect(client.pendingCount()).toBe(1);
    child.pushStdout(`${JSON.stringify({ id: 2, result: { data: [] } })}\n`);

    await expect(pending).resolves.toEqual({ data: [] });
    expect(client.pendingCount()).toBe(0);
  });

  it('rejects_request_on_server_error', async () => {
    const { client, child } = await started();

    const pending = client.request('thread/list');
    pushMessage(child, { id: 2, error: { code: -32601, message: 'method not found' } });

    await expect(pending).rejects.toThrowError(/method not found/);
    expect(client.pendingCount()).toBe(0);
  });

  it('rejects_request_on_timeout_and_clears_entry', async () => {
    const { client } = await started(10);

    const pending = client.request('thread/list');

    await expect(pending).rejects.toThrowError(/timed out/);
    expect(client.pendingCount()).toBe(0);
  });

  it('dispose_kills_process_and_rejects_pending', async () => {
    const { client, child } = await started();

    const pending = client.request('thread/list');
    client.dispose();

    expect(child.killed).toBe(true);
    await expect(pending).rejects.toThrowError(/disposed/);
    expect(client.pendingCount()).toBe(0);
  });
});
