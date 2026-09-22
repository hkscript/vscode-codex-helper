/**
 * 用一次性 `codex app-server` 子进程建出一个**面板能打开**的会话。
 *
 * 为什么需要这一层（都是本机 probe 出来的事实，不是文档承诺）：
 *  - `thread/start` 只给 id，rollout 文件并不落盘；此时 `thread/resume` 报
 *    `no rollout found for thread id <id>`，Codex 面板 hydrate 时正是靠 resume。
 *  - 先做一次成功的状态写入（`thread/metadata/update` 带 gitInfo）再 resume，Codex
 *    就会把 rollout 头写到磁盘上，随后**别的进程**（= Codex 面板自己的 app-server）
 *    resume 得动，用户在里面发消息也一切正常。
 *  - `thread/name/set` 同样能让 resume 成功，但它会把会话名固定住、顶掉 Codex 的
 *    自动标题，所以这里只用 `metadata/update`；而它要求至少一个字段，所以只能写
 *    探测到的**真实** git 信息。
 *  - resume 会持有该会话的 writer 锁，只要这个进程活着，Codex 面板的 resume 就会
 *    被拒 `already has an active writer`（`thread/unsubscribe` 也放不掉）。所以调用方
 *    必须在打开标签前把子进程**等退出**，`waitForChildExit` 就是那道闸（带超时兜底）。
 */

export interface SessionCreatorClient {
  /** `initialize` 握手；必须是第一个请求。 */
  start(): Promise<unknown>;
  request<T>(method: string, params?: unknown): Promise<T>;
}

/** 只写入探测得到的字段：服务端要求 gitInfo 至少有一个非空字段。 */
export interface GitInfo {
  branch?: string;
  sha?: string;
  originUrl?: string;
}

export interface CreateBoundSessionOptions {
  /** 会话的工作目录（窗口第一个 workspace folder）；没有就不带 cwd。 */
  cwd: string | null;
  /** 探测不到（不是 git 仓库）时传 `null`：宁可不建，也不建一个面板打不开的空会话。 */
  gitInfo: GitInfo | null;
}

export interface ExitableChild {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export const DEFAULT_EXIT_TIMEOUT_MS = 2_000;

/**
 * 等待子进程真的退出。超时也返回（宁可冒一次锁没放掉的风险，也不能把「新建会话」
 * 卡死），永不抛异常。
 */
export function waitForChildExit(
  child: ExitableChild | null | undefined,
  timeoutMs = DEFAULT_EXIT_TIMEOUT_MS,
): Promise<void> {
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.on('exit', finish);
  });
}

/**
 * 返回可供 `openai-codex://route/local/<id>` 打开的会话 id；任何一步失败都返回
 * `null`，由调用方回退到空白面板（不抛、不报错、不打断用户）。
 */
export async function createBoundSession(
  client: SessionCreatorClient,
  options: CreateBoundSessionOptions,
): Promise<string | null> {
  if (!options.gitInfo) return null;

  try {
    await client.start();

    const started = await client.request<{ thread?: { id?: string } | null }>(
      'thread/start',
      options.cwd ? { cwd: options.cwd } : {},
    );
    const id = started?.thread?.id;
    if (!id) return null;

    await client.request('thread/metadata/update', { threadId: id, gitInfo: options.gitInfo });
    // 这一步才让 Codex 把 rollout 落盘；少了它，面板打开只会得到
    // 「no rollout found」/「Failed to resume chat」。
    await client.request('thread/resume', { threadId: id });
    return id;
  } catch {
    return null;
  }
}
