/**
 * 运行状态判定与写者锁预检共用的那一个 `/proc` 归属扫描器。
 *
 * - 同时到来的调用方合并到同一轮进行中的扫描上，不并排扫两遍；
 * - 结果从扫描**开始**时计，缓存 `ttlMs`：窗口内的 `get()` 直接复用；
 * - `fresh()` 不吃缓存、也不合并已经在跑的那一轮，总是从此刻现扫——给「马上要据此
 *   做决定」的调用方。它的结果照样写回缓存，紧随其后的 `get()` 能直接捡到；
 * - 非 Linux 平台探测不了归属，一律返回 null，走时间阈值降级（design D16）。
 *
 * 返回的 Map 在调用方之间共享，只读。
 */

export interface HeldRolloutScannerDeps {
  platform: NodeJS.Platform;
  /** 真正的扫描，见 `processScan.ts::scanHeldRollouts`。 */
  scan(): Promise<Map<string, number>>;
  now?(): number;
  ttlMs?: number;
}

export interface HeldRolloutScanner {
  /** 合并进行中的扫描，否则复用 ttl 内的结果，都没有才发起新的一轮。 */
  get(): Promise<Map<string, number> | null>;
  /** 总是从此刻发起新的一轮。 */
  fresh(): Promise<Map<string, number> | null>;
}

export const DEFAULT_SCAN_TTL_MS = 1500;

export function createHeldRolloutScanner(deps: HeldRolloutScannerDeps): HeldRolloutScanner {
  const ttlMs = deps.ttlMs ?? DEFAULT_SCAN_TTL_MS;
  const now = deps.now ?? (() => Date.now());
  const supported = deps.platform === 'linux';

  let cached: { startedAt: number; value: Map<string, number> } | undefined;
  let inFlight: Promise<Map<string, number>> | undefined;

  function start(): Promise<Map<string, number>> {
    const startedAt = now();
    const pending: Promise<Map<string, number>> = (async () => deps.scan())()
      .then((value) => {
        // 两轮重叠时（fresh() 追加的那轮可能先回来），缓存只留开始得更晚的那份
        if (!cached || startedAt >= cached.startedAt) cached = { startedAt, value };
        return value;
      })
      .finally(() => {
        if (inFlight === pending) inFlight = undefined;
      });
    inFlight = pending;
    return pending;
  }

  return {
    async get() {
      if (!supported) return null;
      // 进行中的那轮一定比缓存新
      if (inFlight) return inFlight;
      if (cached && now() - cached.startedAt < ttlMs) return cached.value;
      return start();
    },

    async fresh() {
      if (!supported) return null;
      return start();
    },
  };
}
