import { describe, expect, it } from 'vitest';
import { REASONING_EFFORT_KEY, createConfigWriter } from '../../src/codex/configWriter';

/**
 * 配置写入走 app-server 自己的接口（`config/read` + `config/batchWrite`），
 * 不自己去改 config.toml：只有这样才会走它内部的 TOML 合并，并且软链文件、
 * 注释、其它键都原样保留（本机 probe 实测）。
 */
function makeClient(current: string | null | undefined) {
  const requests: Array<{ method: string; params?: unknown }> = [];
  const request = async <T,>(method: string, params?: unknown): Promise<T> => {
    requests.push({ method, params });
    if (method === 'config/read') {
      return { config: { model_reasoning_effort: current ?? null } } as T;
    }
    return { status: 'ok' } as T;
  };
  return { client: { request }, requests };
}

describe('config writer', () => {
  // REQ: 新建会话记忆思考级别 / Scenario: 配置里的级别与目标不同就写
  it('writes_the_effort_when_the_config_holds_another_level', async () => {
    const { client, requests } = makeClient('low');
    const written = await createConfigWriter(client).syncReasoningEffort('high');

    expect(written).toBe(true);
    expect(requests.map((request) => request.method)).toEqual(['config/read', 'config/batchWrite']);
    expect(requests[1]!.params).toEqual({
      edits: [{ keyPath: REASONING_EFFORT_KEY, value: 'high', mergeStrategy: 'upsert' }],
      filePath: null,
      expectedVersion: null,
      reloadUserConfig: true,
    });
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 已经是要写的级别就不动文件
  it('skips_the_write_when_the_config_already_matches', async () => {
    const { client, requests } = makeClient('high');
    const written = await createConfigWriter(client).syncReasoningEffort('high');

    expect(written).toBe(false);
    expect(requests.map((request) => request.method)).toEqual(['config/read']);
  });

  // REQ: 新建会话记忆思考级别 / Scenario: 配置里没有级别时补写
  it('writes_when_the_config_has_no_level', async () => {
    const { client, requests } = makeClient(null);
    const written = await createConfigWriter(client).syncReasoningEffort('medium');

    expect(written).toBe(true);
    expect(requests.map((request) => request.method)).toEqual(['config/read', 'config/batchWrite']);
  });
});
