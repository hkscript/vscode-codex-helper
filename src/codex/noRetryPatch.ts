import { join } from 'node:path';

/**
 * Codex 扩展宿主的 fetch 包装器「不重试」补丁。
 *
 * 为什么需要它（实测）：扩展宿主那段 fetch 包装器只在**网络异常**和
 * 408/425/429/5xx 上重试，次数上限是 3（合计 4 次尝试），每次退避
 * `min(2000, 300·2^n) ms`（≈300/600/1200）。在 `*.chatgpt.com` 连不通的网络里，
 * 新建会话面板要等这条 statsig 初始化走完 4 次尝试 + 退避 ≈2.1~3.4s 才挂载路由。
 * 把次数上限改成 0 后第一次失败即返回，这个等待窗口消失。
 *
 * 同一个扩展宿主文件里还顺带放宽面板的启动超时（见 `STARTUP_TIMEOUT_FROM`）。
 *
 * 这里只做**文本级定点替换**（与 `~/.local/bin/patch-codex-noretry.sh` 同一套串）：
 * 幂等、改前备份、写后校验、校验不过自动回滚；调用方在打开标签页时 fire-and-forget。
 */

export const NO_RETRY_FROM = 'pj=3,hyt=300,gyt=2e3';
export const NO_RETRY_TO = 'pj=0,hyt=300,gyt=2e3';
/** Codex 26.1021 起改了压缩变量名：`I9=3,aGt=300,uGt=2e3`。 */
export const NO_RETRY_CURRENT_FROM = 'I9=3,aGt=300,uGt=2e3';
export const NO_RETRY_CURRENT_TO = 'I9=0,aGt=300,uGt=2e3';
/** Webview 里 Statsig SDK 自己的初始化请求默认重试 2 次（合计 3 次）。 */
export const STATSIG_RETRY_FROM = 'retries:2,isStatsigEncodable:!0';
export const STATSIG_RETRY_TO = 'retries:0,isStatsigEncodable:!0';
/**
 * 面板 30 秒内没报 renderer ready，Codex 就把整个标签换成「Codex could not start」错误页，
 * 只能关掉重开。26.1021 起面板启动要逐个加载约 3000 个模块，WSL 远程下常态 15~30s
 * （本机日志里撞线过多次），放宽到 120s 只是让慢加载能等到加载完，正常路径不受影响。
 * 锚点里是属性名（压缩不会改名），比压缩变量名稳定。
 */
export const STARTUP_TIMEOUT_FROM =
  'receivedWebviewMessage:this.receivedWebviewMessage,timeoutMs:3e4})},3e4)';
export const STARTUP_TIMEOUT_TO =
  'receivedWebviewMessage:this.receivedWebviewMessage,timeoutMs:12e4})},12e4)';
export const NO_RETRY_BACKUP_SUFFIX = '.orig-noretry';
export const CODEX_EXTENSION_ENTRY = 'out/extension.js';
const STATSIG_ASSET_DIR = 'webview/assets';
const STATSIG_ASSET_PREFIX = 'statsig-';

const NO_RETRY_SIGNATURES = [
  { from: NO_RETRY_FROM, to: NO_RETRY_TO },
  { from: NO_RETRY_CURRENT_FROM, to: NO_RETRY_CURRENT_TO },
] as const;

export type PatchState = 'patched' | 'unpatched' | 'unknown';

/** 以文件内容判定状态：已打 / 可打 / 目标串不存在（上游换了打包形式）。 */
export function readPatchState(content: string): PatchState {
  if (NO_RETRY_SIGNATURES.some(({ to }) => content.includes(to))) return 'patched';
  if (NO_RETRY_SIGNATURES.some(({ from }) => content.includes(from))) return 'unpatched';
  return 'unknown';
}

/** 命中目标串时返回替换后的文本；否则 null —— 不猜、不做模糊匹配。 */
export function patchNoRetryText(content: string): string | null {
  const signature = NO_RETRY_SIGNATURES.find(({ from }) => content.includes(from));
  if (!signature) return null;
  const at = content.indexOf(signature.from);
  if (at < 0) return null;
  const patched =
    content.slice(0, at) + signature.to + content.slice(at + signature.from.length);
  return readPatchState(patched) === 'patched' ? patched : null;
}

/** Statsig 文件里同时有初始化与 live overlay 两处 `retries:2`，必须全部改掉。 */
export function readStatsigRetryState(content: string): PatchState {
  if (content.includes(STATSIG_RETRY_FROM)) return 'unpatched';
  if (content.includes(STATSIG_RETRY_TO)) return 'patched';
  return 'unknown';
}

export function patchStatsigRetryText(content: string): string | null {
  if (!content.includes(STATSIG_RETRY_FROM)) return null;
  const patched = content.replaceAll(STATSIG_RETRY_FROM, STATSIG_RETRY_TO);
  return readStatsigRetryState(patched) === 'patched' ? patched : null;
}

export function readStartupTimeoutState(content: string): PatchState {
  if (content.includes(STARTUP_TIMEOUT_TO)) return 'patched';
  if (content.includes(STARTUP_TIMEOUT_FROM)) return 'unpatched';
  return 'unknown';
}

export function patchStartupTimeoutText(content: string): string | null {
  if (!content.includes(STARTUP_TIMEOUT_FROM)) return null;
  const patched = content.replace(STARTUP_TIMEOUT_FROM, STARTUP_TIMEOUT_TO);
  return readStartupTimeoutState(patched) === 'patched' ? patched : null;
}

/** 一个文件里的一处定点替换。 */
interface FileEdit {
  readState(content: string): PatchState;
  patchText(content: string): string | null;
  label: string;
}

const HOST_EDITS: readonly FileEdit[] = [
  { readState: readPatchState, patchText: patchNoRetryText, label: 'Codex 扩展宿主重试配置串' },
  {
    readState: readStartupTimeoutState,
    patchText: patchStartupTimeoutText,
    label: 'Codex 面板启动超时',
  },
];

const STATSIG_EDITS: readonly FileEdit[] = [
  { readState: readStatsigRetryState, patchText: patchStatsigRetryText, label: 'Statsig 重试配置串' },
];

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
  /** 列出目录里的绝对文件路径；用于发现带 hash 的 Webview 资源。 */
  listFiles(path: string): Promise<string[]>;
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

  async function ensureFile(
    target: string,
    edits: readonly FileEdit[],
  ): Promise<'changed' | 'already' | 'unknown' | 'failed'> {
    const backup = `${target}${NO_RETRY_BACKUP_SUFFIX}`;

    let original: string;
    try {
      original = await deps.readFile(target);
    } catch (error) {
      const labels = edits.map((edit) => edit.label).join('、');
      deps.log(`读取 ${target} 失败，跳过${labels}：${reasonOf(error)}`);
      return 'failed';
    }

    // 同一文件里的几处替换互相独立：某一处找不到目标串只跳过那一处，不连累其它几处
    let patched = original;
    const applied: FileEdit[] = [];
    let anyAlready = false;
    for (const edit of edits) {
      const state = edit.readState(patched);
      if (state === 'patched') {
        anyAlready = true;
        continue;
      }
      const next = state === 'unpatched' ? edit.patchText(patched) : null;
      if (next === null) {
        deps.log(`未找到目标串（${edit.label}，Codex 扩展可能换了版本或打包形式），跳过`);
        continue;
      }
      patched = next;
      applied.push(edit);
    }
    if (applied.length === 0) return anyAlready ? 'already' : 'unknown';

    // 语法基线：原文件本来就编译不过（例如上游产物含 ESM 语法）时，
    // 不能拿语法当验收标准，否则会把自己回滚成"永远打不上"。
    const baselineCompiles = deps.compiles(original);

    // 回滚到**这次改动之前**的内容，而不是上游备份：文件里可能已有之前版本打上的
    // 其它替换，退回上游原版会把它们一起丢掉。
    async function rollback(): Promise<void> {
      try {
        await deps.writeFile(target, original);
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
      const ok =
        applied.every((edit) => edit.readState(after) === 'patched') &&
        (!baselineCompiles || deps.compiles(after));
      if (!ok) {
        await rollback();
        return 'failed';
      }
    } catch (error) {
      deps.log(`校验补丁结果失败：${reasonOf(error)}`);
      await rollback();
      return 'failed';
    }

    const labels = applied.map((edit) => edit.label).join('、');
    deps.log(`已给 Codex 扩展打上补丁（${labels}）：${target}（备份 ${NO_RETRY_BACKUP_SUFFIX}）`);
    return 'changed';
  }

  async function run(): Promise<EnsureOutcome> {
    const dir = deps.extensionPath();
    if (!dir) {
      deps.log('未找到 Codex 扩展，跳过「不重试」补丁');
      return 'skipped';
    }

    const results: Array<'changed' | 'already' | 'unknown' | 'failed'> = [];
    results.push(await ensureFile(join(dir, CODEX_EXTENSION_ENTRY), HOST_EDITS));

    let assets: string[] = [];
    try {
      assets = (await deps.listFiles(join(dir, STATSIG_ASSET_DIR))).filter((path) => {
        const name = path.slice(path.lastIndexOf('/') + 1);
        return name.startsWith(STATSIG_ASSET_PREFIX) && name.endsWith('.js');
      });
    } catch (error) {
      deps.log(`读取 Codex Webview 资源目录失败，跳过 Statsig 补丁：${reasonOf(error)}`);
    }

    for (const asset of assets) {
      results.push(await ensureFile(asset, STATSIG_EDITS));
    }

    if (results.includes('failed')) return 'failed';
    if (results.includes('changed')) return 'patched-now';
    if (results.includes('already')) return 'already';
    return 'unknown';
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
            deps.notify(
              '已为 Codex 面板关闭请求重试、把启动超时放宽到 120 秒（原文件已备份），重载窗口后生效。',
            );
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
