/**
 * 通过 app-server 自己的配置接口写 `~/.codex/config.toml`。
 *
 * 为什么不直接读文件、拼字符串再写回去：
 *  - `config/batchWrite` 自己做 TOML 合并，注释、其它键、[section] 全都保留；
 *  - 它写的是「软链指向的真实文件」，不会像 `writeFile` 那样把软链替换成普通文件
 *    （本机 probe 实测：`config.toml -> ../ai/my-skills/.codex/config.toml` 写完之后软链还在）；
 *  - `reloadUserConfig: true` 会把这个改动热加载进当前进程。
 *
 * 参数形状取自 `codex app-server generate-json-schema` 的 `ConfigBatchWriteParams`
 * （面板自己在「保存默认模型」时用的是同一条请求）。
 */

/** 思考级别在 config.toml 里的键名。 */
export const REASONING_EFFORT_KEY = 'model_reasoning_effort';

export interface ConfigWriterClient {
  request<T>(method: string, params?: unknown): Promise<T>;
}

export interface ConfigWriter {
  /** 真的改了文件返回 true；配置里已经就是这个值返回 false。 */
  syncReasoningEffort(effort: string): Promise<boolean>;
}

export function createConfigWriter(client: ConfigWriterClient): ConfigWriter {
  return {
    async syncReasoningEffort(effort: string): Promise<boolean> {
      // 先读一眼当前值：一样就不写，免得每次新建会话都给这个（很可能被 git 跟踪的）
      // 配置文件制造一次无意义的改动。
      const current = await client.request<{
        config?: { model_reasoning_effort?: string | null } | null;
      }>('config/read', { includeLayers: false });
      if (current?.config?.model_reasoning_effort === effort) return false;

      await client.request('config/batchWrite', {
        edits: [{ keyPath: REASONING_EFFORT_KEY, value: effort, mergeStrategy: 'upsert' }],
        filePath: null,
        expectedVersion: null,
        reloadUserConfig: true,
      });
      return true;
    },
  };
}
