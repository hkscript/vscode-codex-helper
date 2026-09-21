import { join } from 'node:path';

/**
 * Codex 扩展宿主的 fetch 包装器「不重试」补丁。
 *
 * 为什么需要它（实测）：扩展宿主那段 fetch 包装器只在**网络异常**和
 * 408/425/429/5xx 上重试，次数上限是 `pj=3`（合计 4 次尝试），每次退避
 * `min(2000, 300·2^n) ms`（≈300/600/1200）。在 `*.chatgpt.com` 连不通的网络里，
 * 新建会话面板要等这条 statsig 初始化走完 4 次尝试 + 退避 ≈2.1~3.4s 才挂载路由。
 * 把 `pj` 改成 0 后第一次失败即返回，这个等待窗口消失。
 *
 * 这里只做**文本级定点替换**（与 `~/.local/bin/patch-codex-noretry.sh` 同一套串）：
 * 幂等、改前备份、写后校验、校验不过自动回滚；调用方在打开标签页时 fire-and-forget。
 */

export const NO_RETRY_FROM = 'pj=3,hyt=300,gyt=2e3';
export const NO_RETRY_TO = 'pj=0,hyt=300,gyt=2e3';
export const NO_RETRY_BACKUP_SUFFIX = '.orig-noretry';
export const CODEX_EXTENSION_ENTRY = 'out/extension.js';

export type PatchState = 'patched' | 'unpatched' | 'unknown';

/** 以文件内容判定状态：已打 / 可打 / 目标串不存在（上游换了打包形式）。 */
export function readPatchState(content: string): PatchState {
  if (content.includes(NO_RETRY_TO)) return 'patched';
  if (content.includes(NO_RETRY_FROM)) return 'unpatched';
  return 'unknown';
}

/** 命中目标串时返回替换后的文本；否则 null —— 不猜、不做模糊匹配。 */
export function patchNoRetryText(content: string): string | null {
  const at = content.indexOf(NO_RETRY_FROM);
  if (at < 0) return null;
  const patched = content.slice(0, at) + NO_RETRY_TO + content.slice(at + NO_RETRY_FROM.length);
  return readPatchState(patched) === 'patched' ? patched : null;
}

export type EnsureOutcome =
  /** 这次调用真的改了文件；需要重载窗口才生效 */
  | 'patched-now'
  /** 文件里已经是补丁态 */
  | 'already'
  /** 找不到 Codex 扩展目录，什么都没做 */
  | 'skipped'
  /** 目标串不存在：上游版本/打包形式变了 */
  | 'unknown'
  /** 读、写或校验失败（已尽力回滚） */
  | 'failed';

export interface NoRetryPatchDeps {
  /** Codex 扩展的安装目录；拿不到就整体跳过。 */
  extensionPath(): string | undefined;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** 只编译不执行的语法校验：false 表示这份文本不可用。 */
  compiles(content: string): boolean;
  log(message: string): void;
}

export interface NoRetryPatcher {
  /** 幂等：进程内只真正执行一次，之后的调用直接复用第一次的结果。 */
  ensure(): Promise<EnsureOutcome>;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createNoRetryPatcher(deps: NoRetryPatchDeps): NoRetryPatcher {
  let cached: Promise<EnsureOutcome> | undefined;

  async function run(): Promise<EnsureOutcome> {
    const dir = deps.extensionPath();
    if (!dir) {
      deps.log('未找到 Codex 扩展，跳过「不重试」补丁');
      return 'skipped';
    }

    const target = join(dir, CODEX_EXTENSION_ENTRY);
    const backup = `${target}${NO_RETRY_BACKUP_SUFFIX}`;

    let original: string;
    try {
      original = await deps.readFile(target);
    } catch (error) {
      deps.log(`读取 ${target} 失败，跳过「不重试」补丁：${reasonOf(error)}`);
      return 'failed';
    }

    const state = readPatchState(original);
    if (state === 'patched') return 'already';
    if (state === 'unknown') {
      deps.log(`未找到目标串 ${NO_RETRY_FROM}（Codex 扩展可能换了版本或打包形式），跳过`);
      return 'unknown';
    }

    const patched = patchNoRetryText(original);
    if (patched === null) return 'unknown';

    // 语法基线：原文件本来就编译不过（例如上游产物含 ESM 语法）时，
    // 不能拿语法当验收标准，否则会把自己回滚成"永远打不上"。
    const baselineCompiles = deps.compiles(original);

    async function rollback(): Promise<void> {
      try {
        await deps.copyFile(backup, target);
        deps.log(`校验未通过，已把 ${target} 回滚到补丁前`);
      } catch (error) {
        deps.log(`回滚失败，请手动用 ${backup} 恢复：${reasonOf(error)}`);
      }
    }

    try {
      // 备份只建一次：它永远是上游原版，不会被补丁版覆盖（幂等的前提）。
      if (!(await deps.exists(backup))) await deps.copyFile(target, backup);
      await deps.writeFile(target, patched);
    } catch (error) {
      deps.log(`写入「不重试」补丁失败：${reasonOf(error)}`);
      await rollback();
      return 'failed';
    }

    try {
      const after = await deps.readFile(target);
      const ok = readPatchState(after) === 'patched' && (!baselineCompiles || deps.compiles(after));
      if (!ok) {
        await rollback();
        return 'failed';
      }
    } catch (error) {
      deps.log(`校验补丁结果失败：${reasonOf(error)}`);
      await rollback();
      return 'failed';
    }

    deps.log(`已给 Codex 扩展打上「不重试」补丁：${target}（备份 ${NO_RETRY_BACKUP_SUFFIX}）`);
    return 'patched-now';
  }

  return {
    ensure(): Promise<EnsureOutcome> {
      cached ??= run();
      return cached;
    },
  };
}

export interface PatchOnOpenDeps {
  /** 运行时读配置：关掉就什么都不做。 */
  enabled(): boolean;
  patcher: NoRetryPatcher;
  notify(message: string): void;
  log(message: string): void;
}

/**
 * 「打开标签页」时的钩子。
 *
 * 契约：**同步返回、永不抛异常、绝不阻塞打开动作** —— 打开标签是用户的主诉求，
 * 补丁只是顺带的后台动作；真正的文件改写发生在后台 promise 里。
 */
export function createPatchOnOpen(deps: PatchOnOpenDeps): () => void {
  let notified = false;

  return function patchOnOpen(): void {
    try {
      if (!deps.enabled()) return;
      void Promise.resolve(deps.patcher.ensure())
        .then((outcome) => {
          // 只在"这次真的改了文件"时提示一次：它需要重载窗口才生效。
          if (outcome === 'patched-now' && !notified) {
            notified = true;
            deps.notify('已为 Codex 面板关闭请求重试（原文件已备份），重载窗口后生效。');
          }
        })
        .catch((error: unknown) => {
          deps.log(`「不重试」补丁执行失败：${reasonOf(error)}`);
        });
    } catch (error) {
      deps.log(`「不重试」补丁执行失败：${reasonOf(error)}`);
    }
  };
}
