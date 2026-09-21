# 会话运行中标识 + 置顶不被打开状态掏空 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧边栏条目能显示「该会话是否正在执行回合」，且置顶会话被打开后仍保留在「置顶」分组并带置顶标识。

**Architecture:** 三个新的注入式纯模块（`processScan` 扫 `/proc` 得出被持有的 rollout 文件、`runningState` 做纯函数判定、`runningTracker` 编排扫描→查询→计算→监听→去抖→变化回调），再把运行集合透传进既有的 `buildSessionGroups` → `treeProvider` 链路。分组规则从「三组互斥」降级为「历史组与另两组互斥」。

**Tech Stack:** TypeScript 5.6、vitest 2.1（`pnpm test` → `vitest run`）、esbuild、VS Code 1.96 扩展 API（测试中 `vscode` 由 `vitest.config.ts` alias 到 `test/helpers/fakes.ts`）。

**Spec:** `openspec/changes/add-session-running-and-pin-indicators/design.md`（配套 `proposal.md` / `specs/` / `test-plan.md` / `plan-ready.md`）

## Global Constraints

- 运行判定谓词 = `无终止记录(最新回合) ∧ 归属存活(rollout 文件)`，**不含时间阈值**（D14）。
- `无终止记录(turn)` = `turn.status === 'inProgress' || (turn.status === 'interrupted' && turn.completedAt == null)`；`completedAt` 非 null 一律视为已终止（D15 + §6.1 第 14 行）。
- 归属探测只在 Linux 实现（扫 `/proc/<pid>/fd`）；其他平台 `heldRollouts` 传 `null`，走 `updatedAt` 时间阈值降级（D16/D18）。
- 禁止使用 `thread/resume` 做归属探针（D17）。
- 树节点 id 必须是 `session:<groupId>:<sessionId>`（D20）。
- 运行中占图标位 `ThemeIcon('loading~spin')`，置顶占 `description` 前缀 `📌`（D21）。
- `contextValue` 优先级 `pinned > open > 普通`（D22）；`package.json` 的 `when` 表达式**不改**。
- 运行集合**变化时才**回调 `onChange`（D23，防 `refresh → load → update → refresh` 自激）。
- 单个会话的 `listTurns` 失败按「非运行」吞掉，不冒泡（D24）。
- 重算带代际号，迟到的旧结果直接丢弃（D25）。
- `thread/turns/list` 的 `sortDirection` 只接受 `'desc'`，传 `'descending'` 会被服务端以 `-32600` 拒绝。
- 时间单位约定：`Thread.updatedAt` 与 `runningState` 的 `nowSeconds` 都是**epoch 秒**；`runningTracker` 的 `now()` 返回**毫秒**，内部除以 1000 后传入。
- 验证命令：`pnpm test`（全量）、`pnpm test -- <文件名>`（单文件）、`pnpm typecheck`、`pnpm build`。
- 每个 task 的测试用例已经以 `expect.fail('TODO: ...')` 桩的形式存在于对应测试文件中——**补全桩体，不新建测试文件**。
- 每个 task 完成后必须同步：`test-plan.md` 对应行追加 `🔴 RED`（Step 2 时）与 `✅ PASS`（Step 4 后）、`plan-ready.md` 对应 checkbox 改 `[x]`。

---

## File Structure

| 文件 | 责任 | 状态 |
|------|------|------|
| `src/codex/types.ts` | 共享类型：`Thread.path`、`Turn` / `TurnStatus`、`SessionItem.running` | 改 |
| `src/codex/threadApi.ts` | `thread/*` 的类型化封装，新增 `listTurns` | 改 |
| `src/session/processScan.ts` | 扫 `/proc` → `Map<threadId, pid>`，注入 fs | **新建** |
| `src/session/runningState.ts` | 纯函数：`hasNoTerminalRecord` / `selectCandidates` / `computeRunningIds` | **新建** |
| `src/session/runningTracker.ts` | 编排 + 监听 + 去抖 + 轮询兜底 + 代际号 | **新建** |
| `src/session/sessionStore.ts` | 分组装配，`taken` 降级为历史排除集，透传 `runningIds` | 改 |
| `src/ui/treeProvider.ts` | 节点 id / 图标 / description / contextValue | 改 |
| `src/extension.ts` | 接线：构造 tracker、`load()` 透传、`deactivate` 回收 | 改 |
| `package.json` | 3 个新配置项 | 改 |
| `test/helpers/fakes.ts` | 新增 `makeTurn` fixture | 改 |

---

### Task 1: 类型扩展与回合列表 API

**Files:**
- Modify: `src/codex/types.ts`（`Thread` 33-40、`SessionItem` 55-63）
- Modify: `src/codex/threadApi.ts`（`ThreadApi` 接口 19-23、`createThreadApi` 返回对象 33-57）
- Modify: `test/helpers/fakes.ts`（域 fixture 区，`makeOpenTab` 之后）
- Test: `test/unit/threadApi.test.ts::list_turns_requests_latest_turn_in_descending_order`

**Interfaces:**
- Produces:
  - `Thread.path?: string | null`
  - `type TurnStatus = 'inProgress' | 'completed' | 'interrupted' | 'failed'`
  - `interface Turn { id: string; status: TurnStatus; startedAt?: number | null; completedAt?: number | null }`
  - `SessionItem.running: boolean`
  - `ThreadApi.listTurns(threadId: string, limit?: number): Promise<Turn | undefined>`
  - `makeTurn(partial: Partial<Turn> & { id: string }): Turn`

- [ ] **Step 1: 补全 T-012 的测试桩**

替换 `test/unit/threadApi.test.ts` 中 `list_turns_requests_latest_turn_in_descending_order` 的桩体：

```ts
  it('list_turns_requests_latest_turn_in_descending_order', async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    let turns: unknown[] = [makeTurn({ id: 'turn-2', status: 'interrupted', completedAt: null })];
    const client = {
      request<T>(method: string, params?: unknown): Promise<T> {
        requests.push({ method, params });
        return Promise.resolve({ data: turns } as T);
      },
    };
    const api = createThreadApi(client);

    const latest = await api.listTurns('t1');

    expect(requests[0]!.method).toBe('thread/turns/list');
    // sortDirection 必须是 'desc'：服务端拒绝 'descending'（-32600），design §2
    expect(requests[0]!.params).toEqual({ threadId: 't1', limit: 1, sortDirection: 'desc' });
    expect(latest?.id).toBe('turn-2');

    // 没有任何回合时返回 undefined，而不是抛错或返回空对象
    turns = [];
    expect(await api.listTurns('t1')).toBeUndefined();
  });
```

同时把 import 改成 `import { makeThread, makeTurn } from '../helpers/fakes';`。

- [ ] **Step 2: 运行测试确认 FAIL（红）**

Run: `pnpm test -- threadApi`
Expected: FAIL — `api.listTurns is not a function`。贴出失败输出，然后在 `test-plan.md` 的 `T-012` 行尾追加 ` 🔴 RED`。

- [ ] **Step 3: 写最小实现**

`src/codex/types.ts` — `Thread` 增加 `path`，新增 `TurnStatus` / `Turn`，`SessionItem` 增加 `running`：

```ts
/** A Codex conversation as returned by `thread/list`. */
export interface Thread {
  id: string;
  name?: string | null;
  preview: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  /** Rollout file path. Optional: the file is created lazily on the first turn. */
  path?: string | null;
}

export type TurnStatus = 'inProgress' | 'completed' | 'interrupted' | 'failed';

/**
 * One turn as returned by `thread/turns/list`.
 *
 * Cross-process reads encode a turn that is *still running* as
 * `interrupted` + `completedAt: null` — see design.md D15.
 */
export interface Turn {
  id: string;
  status: TurnStatus;
  startedAt?: number | null;
  completedAt?: number | null;
}
```

`SessionItem` 加一行 `running: boolean;`（放在 `open` 之后）。

`src/codex/threadApi.ts` — import 补 `Turn`，接口加一行，返回对象加方法：

```ts
import type { ThreadListResponse, Turn } from './types';

export interface ThreadApi {
  listThreads(query?: ThreadListQuery): Promise<ThreadListResponse>;
  listLoadedThreadIds(): Promise<string[]>;
  setThreadName(threadId: string, name: string): Promise<void>;
  listTurns(threadId: string, limit?: number): Promise<Turn | undefined>;
}
```

```ts
    async listTurns(threadId: string, limit = 1): Promise<Turn | undefined> {
      const response = await client.request<{ data?: Turn[] }>('thread/turns/list', {
        threadId,
        limit,
        sortDirection: 'desc',
      });
      return response?.data?.[0];
    },
```

`test/helpers/fakes.ts` — import 补 `Turn`，在 `makeOpenTab` 之后加：

```ts
export function makeTurn(partial: Partial<Turn> & { id: string }): Turn {
  return {
    status: 'completed',
    startedAt: 90,
    completedAt: 100,
    ...partial,
  };
}
```

- [ ] **Step 4: 运行测试确认 PASS（绿）**

Run: `pnpm test -- threadApi` → 5 passed。
Run: `pnpm typecheck` → 此时 `sessionStore.ts::toItem` 会因缺少 `running` 报错，属预期；在本步临时给 `toItem` 的返回对象补 `running: false`（Task 4 会换成真正的透传），让 typecheck 保持绿。

- [ ] **Step 5: 更新状态文件**

`test-plan.md` 的 `T-012` 行尾追加 ` ✅ PASS`；`plan-ready.md` 的 Task 1 checkbox 改 `[x]`。

- [ ] **Step 6: Commit**

```bash
git add src/codex/types.ts src/codex/threadApi.ts src/session/sessionStore.ts test/helpers/fakes.ts test/unit/threadApi.test.ts openspec/changes/add-session-running-and-pin-indicators/test-plan.md openspec/changes/add-session-running-and-pin-indicators/plan-ready.md
git commit -m "feat(codex): add Turn types and thread/turns/list wrapper"
```

---

### Task 2: 进程归属扫描

**Files:**
- Create: `src/session/processScan.ts`
- Test: `test/unit/processScan.test.ts`（T-013 / T-014 / T-015 三个桩）

**Interfaces:**
- Produces:
  - `interface ProcessScanFs { readdirSync(path: string): string[]; readlinkSync(path: string): string; readFileSync(path: string, encoding: 'utf8'): string }`
  - `scanHeldRollouts(options: { fs: ProcessScanFs; procRoot?: string }): Map<string, number>` — key 是 rollout 文件名里的 thread uuid，value 是持有它的 pid。

- [ ] **Step 1: 补全 T-013 / T-014 / T-015 三个测试桩**

整份替换 `test/unit/processScan.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { scanHeldRollouts, type ProcessScanFs } from '../../src/session/processScan';

const UUID_A = '0199a6b2-1c3d-7e4f-8a9b-0c1d2e3f4a5b';
const UUID_B = '0199a6b2-1c3d-7e4f-8a9b-0c1d2e3f4a99';

const rollout = (uuid: string) =>
  `/home/hk/.codex/sessions/2026/09/21/rollout-2026-09-21T13-08-48-${uuid}.jsonl`;

/** A `/proc` snapshot: pid → { cmdline, fd links }. */
function fakeProc(
  processes: Record<string, { cmdline: string; fds: Record<string, string> }>,
  overrides: Partial<ProcessScanFs> = {},
): ProcessScanFs {
  const base: ProcessScanFs = {
    readdirSync(path: string): string[] {
      if (path === '/proc') return [...Object.keys(processes), 'self', 'cpuinfo'];
      const pid = path.match(/^\/proc\/(\d+)\/fd$/)?.[1];
      const entry = pid ? processes[pid] : undefined;
      if (!entry) throw new Error(`ENOENT: ${path}`);
      return Object.keys(entry.fds);
    },
    readlinkSync(path: string): string {
      const m = path.match(/^\/proc\/(\d+)\/fd\/(.+)$/);
      const link = m ? processes[m[1]!]?.fds[m[2]!] : undefined;
      if (link === undefined) throw new Error(`ENOENT: ${path}`);
      return link;
    },
    readFileSync(path: string): string {
      const pid = path.match(/^\/proc\/(\d+)\/cmdline$/)?.[1];
      const entry = pid ? processes[pid] : undefined;
      if (!entry) throw new Error(`ENOENT: ${path}`);
      return entry.cmdline;
    },
  };
  return { ...base, ...overrides };
}

describe('processScan', () => {
  it('maps_rollout_file_to_holding_codex_process', () => {
    const fs = fakeProc({
      // cmdline 是 NUL 分隔的，同时含 codex 与 app-server 才算数
      '4242': { cmdline: '/usr/bin/codex\0app-server\0', fds: { '0': '/dev/null', '17': rollout(UUID_A) } },
    });

    const held = scanHeldRollouts({ fs });

    expect(held.get(UUID_A)).toBe(4242);
    expect(held.size).toBe(1);
  });

  it('ignores_rollout_fd_held_by_non_codex_process', () => {
    const fs = fakeProc({
      // 同一个 rollout 被 tail / 编辑器打开，不代表有 app-server 在跑这个会话
      '5150': { cmdline: '/usr/bin/tail\0-f\0', fds: { '3': rollout(UUID_A) } },
      // codex 但不是 app-server 子命令
      '5151': { cmdline: '/usr/bin/codex\0exec\0', fds: { '3': rollout(UUID_B) } },
    });

    const held = scanHeldRollouts({ fs });

    expect(held.has(UUID_A)).toBe(false);
    expect(held.has(UUID_B)).toBe(false);
    expect(held.size).toBe(0);
  });

  it('skips_processes_that_vanish_during_scan', () => {
    const processes = {
      '4242': { cmdline: '/usr/bin/codex\0app-server\0', fds: { '17': rollout(UUID_A) } },
      '4243': { cmdline: '/usr/bin/codex\0app-server\0', fds: { '18': rollout(UUID_B) } },
    };
    const base = fakeProc(processes);
    const fs: ProcessScanFs = {
      ...base,
      readdirSync(path: string): string[] {
        // 4243 在我们读它的 fd 目录时刚好退出了
        if (path === '/proc/4243/fd') throw new Error('ENOENT: /proc/4243/fd');
        return base.readdirSync(path);
      },
    };

    const held = scanHeldRollouts({ fs });

    // 正空间断言：一个进程消失不能让整轮扫描作废，活着的那个必须还在
    expect(held.get(UUID_A)).toBe(4242);
    expect(held.has(UUID_B)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认 FAIL（红）**

Run: `pnpm test -- processScan`
Expected: FAIL — `Failed to resolve import "../../src/session/processScan"`。

这是导入失败而不是断言失败，**必须**在 Step 3 建好文件、让三条测试红在断言上之后才算数：先只创建文件并导出一个返回空 Map 的 `scanHeldRollouts`，重跑，确认三条都红在「期望 4242 得到 undefined」这类断言上，再贴出该输出，然后在 `test-plan.md` 的 `T-013` / `T-014` / `T-015` 行尾各追加 ` 🔴 RED`。

- [ ] **Step 3: 写最小实现**

`src/session/processScan.ts`：

```ts
/**
 * Maps rollout files to the live codex app-server process holding them.
 *
 * Linux only (design D16): a running app-server keeps an open fd on the
 * rollout file of every thread it has loaded, so `/proc/<pid>/fd` answers
 * "is anyone still running this session?" without touching the protocol.
 *
 * Every syscall here races process teardown — `/proc` entries disappear
 * mid-scan. A failure on one entry must skip that entry, never abort the
 * scan (design 改动点 5).
 */

export interface ProcessScanFs {
  readdirSync(path: string): string[];
  readlinkSync(path: string): string;
  readFileSync(path: string, encoding: 'utf8'): string;
}

export interface ScanHeldRolloutsOptions {
  fs: ProcessScanFs;
  procRoot?: string;
}

const ROLLOUT_UUID =
  /rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function isAppServer(cmdline: string): boolean {
  return cmdline.includes('codex') && cmdline.includes('app-server');
}

export function scanHeldRollouts(options: ScanHeldRolloutsOptions): Map<string, number> {
  const { fs } = options;
  const procRoot = options.procRoot ?? '/proc';
  const held = new Map<string, number>();

  let entries: string[];
  try {
    entries = fs.readdirSync(procRoot);
  } catch {
    return held;
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);

    try {
      if (!isAppServer(fs.readFileSync(`${procRoot}/${entry}/cmdline`, 'utf8'))) continue;
    } catch {
      continue;
    }

    let fds: string[];
    try {
      fds = fs.readdirSync(`${procRoot}/${entry}/fd`);
    } catch {
      continue;
    }

    for (const fd of fds) {
      let link: string;
      try {
        link = fs.readlinkSync(`${procRoot}/${entry}/fd/${fd}`);
      } catch {
        continue;
      }
      const uuid = link.match(ROLLOUT_UUID)?.[1];
      if (uuid) held.set(uuid.toLowerCase(), pid);
    }
  }

  return held;
}
```

- [ ] **Step 4: 运行测试确认 PASS（绿）**

Run: `pnpm test -- processScan` → 3 passed。
Run: `pnpm typecheck` → 绿。

- [ ] **Step 5: 更新状态文件**

`test-plan.md` 的 T-013 / T-014 / T-015 行尾各追加 ` ✅ PASS`；`plan-ready.md` 的 Task 2 checkbox 改 `[x]`。

- [ ] **Step 6: Commit**

```bash
git add src/session/processScan.ts test/unit/processScan.test.ts openspec/changes/add-session-running-and-pin-indicators/test-plan.md openspec/changes/add-session-running-and-pin-indicators/plan-ready.md
git commit -m "feat(session): scan /proc for codex processes holding rollout files"
```

---

### Task 3: 运行状态纯函数

**Files:**
- Create: `src/session/runningState.ts`
- Test: `test/unit/runningState.test.ts`（T-001..T-011 + INV-001，共 12 个桩）

**Interfaces:**
- Consumes: `Thread`（含 `path` / `updatedAt`）、`Turn` / `TurnStatus`（Task 1）
- Produces:
  - `hasNoTerminalRecord(turn: Turn | undefined | null): boolean`
  - `selectCandidates(input: { threads: Thread[]; heldRollouts: Map<string, number> | null; nowSeconds: number; staleSeconds: number }): Thread[]`
  - `computeRunningIds(input: { threads: Thread[]; turns: Map<string, Turn | undefined>; heldRollouts: Map<string, number> | null; nowSeconds: number; staleSeconds: number }): Set<string>`
  - `DEFAULT_STALE_SECONDS = 300`

**约定：** `heldRollouts === null` 表示「本平台无法探测归属」（非 Linux），走时间阈值降级；`heldRollouts` 是 Map 时表示探测可用，阈值完全不参与判定。`turns` 里**缺 key 或值为 undefined** 都表示「没有可用的回合记录」（没发过回合，或查询失败——D24 把两者归并为非运行）。

- [ ] **Step 1: 补全 12 个测试桩**

整份替换 `test/unit/runningState.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { Thread, Turn, TurnStatus } from '../../src/codex/types';
import {
  computeRunningIds,
  hasNoTerminalRecord,
  selectCandidates,
} from '../../src/session/runningState';
import { makeThread, makeTurn } from '../helpers/fakes';

const NOW = 1_789_970_400;
const STALE = 300;

function thread(id: string, updatedAt = NOW): Thread {
  return makeThread({ id, updatedAt, path: `/sessions/rollout-2026-09-21T13-08-48-${id}.jsonl` });
}

/** held = 这些 id 被存活进程持有；null = 平台无法探测。 */
function held(...ids: string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, 4000 + index]));
}

function run(
  input: {
    threads: Thread[];
    turns?: Array<[string, Turn | undefined]>;
    heldRollouts?: Map<string, number> | null;
    nowSeconds?: number;
  },
): Set<string> {
  return computeRunningIds({
    threads: input.threads,
    turns: new Map(input.turns ?? []),
    heldRollouts: input.heldRollouts === undefined ? held() : input.heldRollouts,
    nowSeconds: input.nowSeconds ?? NOW,
    staleSeconds: STALE,
  });
}

describe('runningState', () => {
  it('marks_running_when_turn_in_progress_and_owner_alive', () => {
    const t = thread('t1');
    const ids = run({
      threads: [t],
      turns: [['t1', makeTurn({ id: 'turn-1', status: 'inProgress', completedAt: null })]],
      heldRollouts: held('t1'),
    });

    expect(ids.has('t1')).toBe(true);
  });

  it('marks_running_when_interrupted_without_completed_at_and_owner_alive', () => {
    // 跨进程读到的「正在跑」就是这个形状（design D15），不是 inProgress
    const ids = run({
      threads: [thread('t1')],
      turns: [['t1', makeTurn({ id: 'turn-1', status: 'interrupted', completedAt: null })]],
      heldRollouts: held('t1'),
    });

    expect(ids.has('t1')).toBe(true);
    expect(hasNoTerminalRecord(makeTurn({ id: 'x', status: 'interrupted', completedAt: null }))).toBe(true);
  });

  it('not_running_when_latest_turn_has_terminal_record', () => {
    // §6.1 第 3/4/5 行：三种终止状态都必须判非运行
    for (const status of ['completed', 'interrupted', 'failed'] as TurnStatus[]) {
      const ids = run({
        threads: [thread('t1')],
        turns: [['t1', makeTurn({ id: 'turn-1', status, completedAt: NOW - 10 })]],
        heldRollouts: held('t1'),
      });
      expect(ids.has('t1'), `status=${status}`).toBe(false);
    }
  });

  it('not_running_when_no_live_owner_holds_rollout', () => {
    // §6.1 第 6/7 行：没有终止记录，但没人持有 ⇒ 进程死了留下的半截回合
    for (const status of ['inProgress', 'interrupted'] as TurnStatus[]) {
      const ids = run({
        threads: [thread('t1')],
        turns: [['t1', makeTurn({ id: 'turn-1', status, completedAt: null })]],
        heldRollouts: held('other'),
      });
      expect(ids.has('t1'), `status=${status}`).toBe(false);
    }
  });

  it('stale_mtime_does_not_clear_running_when_owner_alive', () => {
    // §6.1 第 2b 行：Linux 路径上时间阈值不参与判定，长思考不能被误杀
    const ids = run({
      threads: [thread('t1', NOW - STALE * 10)],
      turns: [['t1', makeTurn({ id: 'turn-1', status: 'interrupted', completedAt: null })]],
      heldRollouts: held('t1'),
    });

    expect(ids.has('t1')).toBe(true);
  });

  it('not_running_when_thread_has_no_turns', () => {
    const ids = run({ threads: [thread('t1')], turns: [['t1', undefined]], heldRollouts: held('t1') });

    expect(ids.has('t1')).toBe(false);
    expect(hasNoTerminalRecord(undefined)).toBe(false);
  });

  it('missing_rollout_path_is_not_running_and_does_not_throw', () => {
    // rollout 文件延迟创建：只 thread/start 没发回合时 path 为空
    const noPath = makeThread({ id: 't1', path: null, updatedAt: NOW });
    let ids: Set<string> | undefined;

    expect(() => {
      ids = run({
        threads: [noPath],
        turns: [['t1', makeTurn({ id: 'turn-1', status: 'inProgress', completedAt: null })]],
        heldRollouts: held('t1'),
      });
    }).not.toThrow();
    expect(ids!.has('t1')).toBe(false);

    // path 字段整个缺失（旧服务端）同样安全
    expect(run({ threads: [makeThread({ id: 't2', updatedAt: NOW })], heldRollouts: held('t2') }).size).toBe(0);
  });

  it('turn_query_failure_isolates_to_that_session', () => {
    // D24：t1 的查询失败（turns 里没有它）不能带走 t2 的运行标识
    const ids = run({
      threads: [thread('t1'), thread('t2')],
      turns: [['t2', makeTurn({ id: 'turn-2', status: 'inProgress', completedAt: null })]],
      heldRollouts: held('t1', 't2'),
    });

    expect(ids.has('t1')).toBe(false);
    expect(ids.has('t2')).toBe(true);
  });

  it('fallback_marks_running_within_stale_threshold', () => {
    // §6.1 第 11 行：探测不可用 + 刚写过 ⇒ 视为运行中
    const ids = run({
      threads: [thread('t1', NOW - STALE + 1)],
      turns: [['t1', makeTurn({ id: 'turn-1', status: 'interrupted', completedAt: null })]],
      heldRollouts: null,
    });

    expect(ids.has('t1')).toBe(true);
  });

  it('fallback_clears_running_beyond_stale_threshold', () => {
    // §6.1 第 12 行：探测不可用 + 超过阈值 ⇒ 非运行
    const ids = run({
      threads: [thread('t1', NOW - STALE - 1)],
      turns: [['t1', makeTurn({ id: 'turn-1', status: 'interrupted', completedAt: null })]],
      heldRollouts: null,
    });

    expect(ids.has('t1')).toBe(false);
  });

  it('candidates_exclude_sessions_not_held_by_any_process', () => {
    const threads = [thread('t1'), thread('t2'), makeThread({ id: 't3', path: null, updatedAt: NOW })];

    const linux = selectCandidates({
      threads,
      heldRollouts: held('t1'),
      nowSeconds: NOW,
      staleSeconds: STALE,
    });
    // 预筛的意义就是把 N 次 thread/turns/list 压到个位数（D18）
    expect(linux.map((t) => t.id)).toEqual(['t1']);

    // 降级路径按 updatedAt 阈值预筛，没有 path 的一律不入候选
    const fallback = selectCandidates({
      threads: [thread('t1', NOW - 1), thread('t2', NOW - STALE - 1), threads[2]!],
      heldRollouts: null,
      nowSeconds: NOW,
      staleSeconds: STALE,
    });
    expect(fallback.map((t) => t.id)).toEqual(['t1']);
  });

  // INV-001: design §6.1 的四个维度全组合，逐格与独立推导的谓词比对
  it('running_iff_no_terminal_record_and_owner_alive', () => {
    const statuses: Array<TurnStatus | 'none'> = [
      'inProgress',
      'interrupted',
      'completed',
      'failed',
      'none',
    ];
    const ownerships = ['held', 'not-held', 'undetectable'] as const;
    let runningCells = 0;
    let idleCells = 0;

    for (const status of statuses) {
      for (const completed of [true, false]) {
        for (const ownership of ownerships) {
          for (const fresh of [true, false]) {
            const updatedAt = fresh ? NOW - 1 : NOW - STALE - 1;
            const t = thread('t1', updatedAt);
            const turn =
              status === 'none'
                ? undefined
                : makeTurn({ id: 'turn-1', status, completedAt: completed ? NOW - 5 : null });

            const ids = computeRunningIds({
              threads: [t],
              turns: new Map([['t1', turn]]),
              heldRollouts:
                ownership === 'undetectable' ? null : ownership === 'held' ? held('t1') : held('other'),
              nowSeconds: NOW,
              staleSeconds: STALE,
            });

            // 独立推导的期望值：不复用被测实现的任何分支
            const noTerminalRecord =
              turn !== undefined && !completed && (status === 'inProgress' || status === 'interrupted');
            const ownerAlive =
              ownership === 'held' ? true : ownership === 'not-held' ? false : fresh;
            const expected = noTerminalRecord && ownerAlive;

            expect(
              ids.has('t1'),
              `status=${status} completedAt=${completed} owner=${ownership} fresh=${fresh}`,
            ).toBe(expected);

            if (expected) runningCells += 1;
            else idleCells += 1;
          }
        }
      }
    }

    // 反空转护栏：确认循环真的跑满了 5×2×3×2 格，且两类结论都出现过
    expect(runningCells + idleCells).toBe(60);
    expect(runningCells).toBe(10);
    expect(idleCells).toBe(50);
  });
});
```

- [ ] **Step 2: 运行测试确认 FAIL（红）**

Run: `pnpm test -- runningState`
先建空壳（导出三个函数：`hasNoTerminalRecord` 返回 `false`、`selectCandidates` 返回 `[]`、`computeRunningIds` 返回 `new Set()`），重跑，确认 12 条红在断言上而不是导入上（`marks_running_...` 应报 `expected false to be true`）。贴出输出，在 `test-plan.md` 的 T-001..T-011 与 INV-001 行尾各追加 ` 🔴 RED`。

INV-001 此时必须在**多个**组合上报失败（期望 10 个 running 格全红）——只红一格说明断言范围写窄了，回 Step 1 修断言而不是往下写实现。

- [ ] **Step 3: 写最小实现**

`src/session/runningState.ts`：

```ts
import type { Thread, Turn } from '../codex/types';

/**
 * Pure running-state rules (design D14/D15/D18).
 *
 * Nothing here touches the filesystem or the clock: `nowSeconds` and
 * `staleSeconds` arrive as parameters so every branch — including the
 * non-Linux time-threshold fallback — is reachable from a unit test.
 *
 * `heldRollouts === null` means "this platform cannot detect ownership"
 * (macOS / Windows). When it is a Map, ownership is authoritative and the
 * time threshold does not participate in the decision at all.
 */

export const DEFAULT_STALE_SECONDS = 300;

export interface RunningStateInput {
  threads: Thread[];
  heldRollouts: Map<string, number> | null;
  nowSeconds: number;
  staleSeconds: number;
}

export interface ComputeRunningIdsInput extends RunningStateInput {
  /** threadId → latest turn. A missing key or `undefined` means "no usable record" (D24). */
  turns: Map<string, Turn | undefined>;
}

/**
 * True when the latest turn carries no terminal record.
 *
 * `inProgress` is the same-process encoding; `interrupted` + `completedAt: null`
 * is what another process sees for a turn that is still running. A non-null
 * `completedAt` always wins — a user-aborted turn writes `turn_aborted` and is
 * terminal even though its status is `interrupted` (design D15).
 */
export function hasNoTerminalRecord(turn: Turn | undefined | null): boolean {
  if (!turn) return false;
  if (turn.completedAt != null) return false;
  return turn.status === 'inProgress' || turn.status === 'interrupted';
}

function isFresh(thread: Thread, nowSeconds: number, staleSeconds: number): boolean {
  return nowSeconds - thread.updatedAt <= staleSeconds;
}

/**
 * Narrows the thread list down to the sessions worth a `thread/turns/list`
 * round trip. A running session is necessarily held by a live process, so on
 * Linux the held set is both cheap and complete (D18).
 */
export function selectCandidates(input: RunningStateInput): Thread[] {
  const { threads, heldRollouts, nowSeconds, staleSeconds } = input;
  return threads.filter((thread) => {
    if (!thread.path) return false;
    if (heldRollouts) return heldRollouts.has(thread.id);
    return isFresh(thread, nowSeconds, staleSeconds);
  });
}

export function computeRunningIds(input: ComputeRunningIdsInput): Set<string> {
  const { threads, turns, heldRollouts, nowSeconds, staleSeconds } = input;
  const running = new Set<string>();

  for (const thread of threads) {
    // No rollout file ⇒ nobody can be holding it, and "no turn yet" and
    // "file not created yet" are the same state (design 改动点 6).
    if (!thread.path) continue;
    if (!hasNoTerminalRecord(turns.get(thread.id))) continue;

    const ownerAlive = heldRollouts
      ? heldRollouts.has(thread.id)
      : isFresh(thread, nowSeconds, staleSeconds);
    if (ownerAlive) running.add(thread.id);
  }

  return running;
}
```

- [ ] **Step 4: 运行测试确认 PASS（绿）**

Run: `pnpm test -- runningState` → 12 passed。
Run: `pnpm typecheck` → 绿。

- [ ] **Step 5: 更新状态文件**

`test-plan.md` 的 T-001..T-011 与 INV-001 行尾各追加 ` ✅ PASS`；`plan-ready.md` 的 Task 3 checkbox 改 `[x]`。

- [ ] **Step 6: Commit**

```bash
git add src/session/runningState.ts test/unit/runningState.test.ts openspec/changes/add-session-running-and-pin-indicators/test-plan.md openspec/changes/add-session-running-and-pin-indicators/plan-ready.md
git commit -m "feat(session): add pure running-state predicates"
```

---

### Task 4: 分组规则改为非互斥并透传运行标记

**Files:**
- Modify: `src/session/sessionStore.ts`（`BuildSessionGroupsInput` 26-31、`toItem` 62-77、三段分组循环 79-105）
- Test: `test/unit/sessionStore.test.ts`（补全 T-022 / T-023 / T-024 / INV-002 四个桩；**删除** `open_group_wins_over_pinned_group`；**删除** `every_session_appears_in_exactly_one_group`，其职责由 INV-002 承接）

**Interfaces:**
- Consumes: `SessionItem.running`（Task 1）
- Produces: `BuildSessionGroupsInput.runningIds?: Iterable<string> | null`

- [ ] **Step 1: 补全四个桩并删除两个被取代的既有测试**

先删掉 `open_group_wins_over_pinned_group`（整个 `it` 块，41-51 行）——它断言「置顶组中不含已打开的会话」，与新规格直接冲突。

再删掉 `every_session_appears_in_exactly_one_group`（整个 `it` 块）——「恰好一个分组」正是本次要推翻的语义。

然后替换四个桩：

```ts
  it('pinned_session_stays_in_pinned_group_when_open', () => {
    const groups = buildSessionGroups({
      threads,
      openTabs: [makeOpenTab('pin-1', '置顶一')],
      pinnedIds: ['pin-1'],
    });

    // 本次语义翻转（design §6.2 第 1 行）：打开一个置顶会话不再把它从置顶组掏空
    expect(ids(groups, 'open')).toEqual(['pin-1']);
    expect(ids(groups, 'pinned')).toEqual(['pin-1']);
    expect(occurrences(groups, 'pin-1')).toBe(2);
    // 历史组仍与另两组互斥
    expect(ids(groups, 'history')).toEqual(['hist-1', 'hist-2', 'open-1']);

    const pinnedRow = groups.find((group) => group.id === 'pinned')!.sessions[0]!;
    const openRow = groups.find((group) => group.id === 'open')!.sessions[0]!;
    // 两行都得如实说出「这个会话既开着又被置顶」，否则条目上看不出置顶
    expect(pinnedRow.pinned).toBe(true);
    expect(openRow.pinned).toBe(true);
    expect(pinnedRow.open).toBe(true);
    expect(openRow.open).toBe(true);
  });

  it('unpinning_removes_pinned_row_but_keeps_open_row', () => {
    const before = buildSessionGroups({
      threads,
      openTabs: [makeOpenTab('pin-1', '置顶一')],
      pinnedIds: ['pin-1'],
    });
    expect(occurrences(before, 'pin-1')).toBe(2);

    const after = buildSessionGroups({
      threads,
      openTabs: [makeOpenTab('pin-1', '置顶一')],
      pinnedIds: [],
    });

    // 取消置顶：置顶组那行消失，已打开那行保留且不再带置顶标记
    expect(after.find((group) => group.id === 'pinned')).toBeUndefined();
    expect(ids(after, 'open')).toEqual(['pin-1']);
    expect(after.find((group) => group.id === 'open')!.sessions[0]!.pinned).toBe(false);
    expect(occurrences(after, 'pin-1')).toBe(1);
  });

  it('marks_sessions_present_in_running_set', () => {
    const groups = buildSessionGroups({
      threads,
      openTabs: [makeOpenTab('open-1', '已打开一')],
      pinnedIds: ['pin-1'],
      runningIds: ['open-1', 'hist-2'],
    });

    const runningOf = (id: string) =>
      allIds(groups).includes(id) &&
      groups.flatMap((group) => group.sessions).filter((s) => s.id === id).every((s) => s.running);

    expect(runningOf('open-1')).toBe(true);
    expect(runningOf('hist-2')).toBe(true);
    // 正空间之外的会话必须明确为 false，而不是 undefined
    for (const session of groups.flatMap((group) => group.sessions)) {
      expect(typeof session.running, `${session.id}.running`).toBe('boolean');
      if (!['open-1', 'hist-2'].includes(session.id)) {
        expect(session.running, `${session.id} 不该被标成运行中`).toBe(false);
      }
    }
  });

  // INV-002: design §6.2 的 (hasOpenTab × pinned × inThreadList) 8 格全组合
  it('group_membership_matrix_holds_for_all_combinations', () => {
    const target = 's1';
    let checked = 0;
    let openRows = 0;
    let pinnedRows = 0;
    let historyRows = 0;

    for (const hasOpenTab of [true, false]) {
      for (const pinned of [true, false]) {
        for (const inThreadList of [true, false]) {
          const groups = buildSessionGroups({
            threads: inThreadList
              ? [makeThread({ id: target, name: '目标会话' }), threads[0]!]
              : [threads[0]!],
            openTabs: hasOpenTab ? [makeOpenTab(target, '目标会话'), makeOpenTab('other', '其他')] : [],
            pinnedIds: pinned ? [target] : [],
          });

          const label = `(open=${hasOpenTab}, pinned=${pinned}, listed=${inThreadList})`;
          // 独立推导的期望：已打开看标签页；置顶还要求服务端查得到（D8 幽灵置顶丢弃）；
          // 历史 = 服务端有 且 既没打开也没置顶
          const inOpen = hasOpenTab;
          const inPinned = pinned && inThreadList;
          const inHistory = inThreadList && !hasOpenTab && !(pinned && inThreadList);

          expect(ids(groups, 'open').includes(target), `${label} open`).toBe(inOpen);
          expect(ids(groups, 'pinned').includes(target), `${label} pinned`).toBe(inPinned);
          expect(ids(groups, 'history').includes(target), `${label} history`).toBe(inHistory);
          // 历史组与另两组仍然互斥——这条不变量本次没有被推翻
          expect(inHistory && (inOpen || inPinned), `${label} 历史组互斥`).toBe(false);
          expect(occurrences(groups, target), `${label} 行数`).toBe(
            Number(inOpen) + Number(inPinned) + Number(inHistory),
          );

          checked += 1;
          openRows += Number(inOpen);
          pinnedRows += Number(inPinned);
          historyRows += Number(inHistory);
        }
      }
    }

    // 反空转护栏：8 格必须全部跑到，且三种归属都真的出现过
    expect(checked).toBe(8);
    expect(openRows).toBe(4);
    expect(pinnedRows).toBe(2);
    expect(historyRows).toBe(1);
  });
```

- [ ] **Step 2: 运行测试确认 FAIL（红）**

Run: `pnpm test -- sessionStore`
Expected: 4 failed —
`pinned_session_stays_in_pinned_group_when_open` 报 `expected [] to deeply equal [ 'pin-1' ]`（置顶组被掏空）；
`marks_sessions_present_in_running_set` 报 `running` 为 `false`（Task 1 临时写死）；
`group_membership_matrix_holds_for_all_combinations` 在 `(open=true, pinned=true, listed=true) pinned` 格报错。

贴出输出，在 `test-plan.md` 的 T-022 / T-023 / T-024 / INV-002 行尾各追加 ` 🔴 RED`。

- [ ] **Step 3: 写最小实现**

`src/session/sessionStore.ts` — 改文件头注释、入参、`toItem`、三段循环：

```ts
/**
 * Merges the three session sources into the tree's groups.
 *
 * Design decisions encoded here (design.md D7/D8/D19):
 *  - 已打开 and 置顶 may both contain the same session — pinning survives
 *    opening (D19). 历史 stays mutually exclusive with both;
 *  - a pinned id that exists neither in the thread list nor as an open tab is a
 *    stale pin and is dropped (no ghost rows);
 *  - every rendered group is filtered with the same predicate, so "everything
 *    shown matches the filter" holds for all three groups.
 */

export interface BuildSessionGroupsInput {
  threads: Thread[];
  openTabs: OpenTab[];
  pinnedIds: string[];
  runningIds?: Iterable<string> | null;
  filter?: string | null;
}
```

```ts
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  const pinnedSet = new Set(pinnedIds);
  const runningSet = new Set(input.runningIds ?? []);
  // 只管「历史组要排除谁」。已打开与置顶可以同时命中同一个会话（D19）。
  const claimed = new Set<string>();

  function toItem(
    id: string,
    thread: Thread | undefined,
    tabLabel: string | null,
    open: boolean,
  ): SessionItem {
    return {
      id,
      label: sessionItemLabel(thread, tabLabel),
      preview: thread?.preview ?? '',
      cwd: thread?.cwd ?? null,
      updatedAt: thread?.updatedAt ?? null,
      pinned: pinnedSet.has(id),
      open,
      running: runningSet.has(id),
    };
  }

  // 1. 已打开：标签页顺序即显示顺序。未绑定会话的新建标签用合成 id 占位，
  //    好让同一分组内「一个 id 只出现一次」不会被两个同名新标签破坏。
  const open: SessionItem[] = [];
  const openIds = new Set<string>();
  openTabs.forEach((tab: OpenTab, index: number) => {
    const id = tab.id ?? `open-tab:${index}`;
    if (openIds.has(id)) return;
    openIds.add(id);
    claimed.add(id);
    open.push(toItem(id, tab.id ? threadsById.get(tab.id) : undefined, tab.tabLabel, true));
  });

  // 2. 置顶：不再因为「已打开」而跳过（D19）；服务端查不到的陈旧置顶仍然丢弃（D8）。
  const pinned: SessionItem[] = [];
  const pinnedSeen = new Set<string>();
  for (const id of pinnedIds) {
    if (pinnedSeen.has(id)) continue;
    const thread = threadsById.get(id);
    if (!thread) continue;
    pinnedSeen.add(id);
    claimed.add(id);
    // open 如实反映状态：同一会话的两行都该说出「它开着」。
    pinned.push(toItem(id, thread, null, openIds.has(id)));
  }

  // 3. 历史：既没打开也没置顶的全部。
  const history: SessionItem[] = [];
  for (const thread of threads) {
    if (claimed.has(thread.id)) continue;
    claimed.add(thread.id);
    history.push(toItem(thread.id, thread, null, false));
  }
```

- [ ] **Step 4: 运行测试确认 PASS（绿）**

Run: `pnpm test -- sessionStore` → 12 passed（10 既有 − 2 删除 + 4 新增）。
Run: `pnpm typecheck` → 绿。

- [ ] **Step 5: 更新状态文件**

`test-plan.md` 的 T-022 / T-023 / T-024 / INV-002 行尾各追加 ` ✅ PASS`；`plan-ready.md` 的 Task 4 checkbox 改 `[x]`。

- [ ] **Step 6: Commit**

```bash
git add src/session/sessionStore.ts test/unit/sessionStore.test.ts openspec/changes/add-session-running-and-pin-indicators/test-plan.md openspec/changes/add-session-running-and-pin-indicators/plan-ready.md
git commit -m "feat(session): keep pinned rows when a session is open and pass running ids through"
```

---

### Task 5: 树条目的 id、图标、描述与 contextValue

**Files:**
- Modify: `src/ui/treeProvider.ts`（`toItemNode` 76-90、`getChildren` 106-108、`getTreeItem` 图标行 147）
- Test: `test/unit/treeProvider.test.ts`（补全 T-025 / T-026 / T-027 / T-028 四个桩）

**Interfaces:**
- Consumes: `SessionItem.running`（Task 1）、双行分组（Task 4）
- Produces: `SessionItemNode.id === 'session:<groupId>:<sessionId>'`

- [ ] **Step 1: 补全四个桩**

先把 import 补齐：`import { TreeItemCollapsibleState, ThemeIcon, makeOpenTab, makeThread } from '../helpers/fakes';`，并在文件顶部加一个取会话节点的小工具：

```ts
async function sessionNodes(groups: SessionGroup[], groupId: string) {
  const provider = createSessionTreeProvider({ load: async () => groups });
  const roots = await provider.getChildren();
  const group = roots.find(
    (node): node is SessionGroupNode => node.kind === 'group' && node.group.id === groupId,
  );
  if (!group) throw new Error(`missing group node: ${groupId}`);
  return { provider, nodes: await provider.getChildren(group) };
}
```

然后替换四个桩：

```ts
  it('same_session_gets_distinct_node_ids_per_group', async () => {
    const groups = buildSessionGroups({
      threads: [makeThread({ id: 'pin-1', name: '钉住又开着的' })],
      openTabs: [makeOpenTab('pin-1', '钉住又开着的')],
      pinnedIds: ['pin-1'],
    });

    const open = await sessionNodes(groups, 'open');
    const pinned = await sessionNodes(groups, 'pinned');

    // VS Code 按 TreeItem.id 记忆折叠/选中状态：两行同 id 会互相串台（D20）
    expect(open.nodes[0]!.id).toBe('session:open:pin-1');
    expect(pinned.nodes[0]!.id).toBe('session:pinned:pin-1');
    expect(open.provider.getTreeItem(open.nodes[0]!).id).toBe('session:open:pin-1');
    expect(pinned.provider.getTreeItem(pinned.nodes[0]!).id).toBe('session:pinned:pin-1');
  });

  it('running_session_uses_spinner_icon', async () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 'busy', name: '正在跑' }),
        makeThread({ id: 'idle', name: '闲着' }),
      ],
      openTabs: [],
      pinnedIds: [],
      runningIds: ['busy'],
    });

    const { provider, nodes } = await sessionNodes(groups, 'history');
    const iconOf = (id: string) =>
      provider.getTreeItem(nodes.find((node) => node.id.endsWith(id))!).iconPath as ThemeIcon;

    expect(iconOf('busy').id).toBe('loading~spin');
    // 非运行的条目图标不变，避免「全都在转」看不出区别
    expect(iconOf('idle').id).toBe('comment-discussion');
  });

  it('pinned_session_description_starts_with_pin_marker', async () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 'pin-1', name: '钉住的', preview: '钉住的预览' }),
        makeThread({ id: 'plain', name: '普通的', preview: '普通的预览' }),
      ],
      openTabs: [],
      pinnedIds: ['pin-1'],
    });

    const pinned = await sessionNodes(groups, 'pinned');
    const history = await sessionNodes(groups, 'history');

    // 图标位被运行状态占着，置顶只能落在 description 上（D21）
    expect(String(pinned.nodes[0]!.description).startsWith('📌')).toBe(true);
    expect(String(pinned.nodes[0]!.description)).toContain('钉住的预览');
    expect(String(pinned.provider.getTreeItem(pinned.nodes[0]!).description).startsWith('📌')).toBe(true);
    // 没置顶的条目不能平白多出一个图钉
    expect(String(history.nodes[0]!.description ?? '')).not.toContain('📌');
  });

  it('open_and_pinned_item_context_value_is_pinned', async () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 'pin-1', name: '钉住又开着的' }),
        makeThread({ id: 'plain', name: '普通的' }),
      ],
      openTabs: [makeOpenTab('pin-1', '钉住又开着的'), makeOpenTab('open-only', '只开着的')],
      pinnedIds: ['pin-1'],
    });

    const open = await sessionNodes(groups, 'open');
    const history = await sessionNodes(groups, 'history');
    const contextOf = (nodes: typeof open.nodes, id: string) =>
      nodes.find((node) => node.id.endsWith(id))!.contextValue;

    // package.json 的 unpin 菜单挂在 session.pinned 上：已打开且已置顶必须给「取消置顶」（D22）
    expect(contextOf(open.nodes, 'pin-1')).toBe('session.pinned');
    expect(contextOf(open.nodes, 'open-only')).toBe('session.open');
    expect(contextOf(history.nodes, 'plain')).toBe('session');
  });
```

- [ ] **Step 2: 运行测试确认 FAIL（红）**

Run: `pnpm test -- treeProvider`
Expected: 4 failed — id 仍是 `session:pin-1`、图标仍是 `comment-discussion`、description 无 `📌`、contextValue 为 `session.open`。贴出输出，在 `test-plan.md` 的 T-025..T-028 行尾各追加 ` 🔴 RED`。

- [ ] **Step 3: 写最小实现**

`src/ui/treeProvider.ts`：

```ts
  function toItemNode(session: SessionItem, groupId: SessionGroupId): SessionItemNode {
    // 置顶优先于已打开：右键菜单的语义锚点是「置顶与否」，
    // 已打开且已置顶的条目必须给出「取消置顶」（D22）。
    const contextValue = session.pinned
      ? ('session.pinned' as const)
      : session.open
        ? ('session.open' as const)
        : ('session' as const);
    const preview = session.preview === session.label ? undefined : session.preview;
    // 图标位归运行状态，置顶只能占 description 前缀（D21）。
    const description = session.pinned ? `📌 ${preview ?? ''}`.trimEnd() : preview;
    return {
      kind: 'session',
      // 同一会话可能同时出现在已打开与置顶两组；id 不带分组段会让
      // VS Code 拿同一个 id 记两行的折叠/选中状态（D20）。
      id: `session:${groupId}:${session.id}`,
      label: session.label,
      description,
      contextValue,
      session,
    };
  }
```

import 补 `SessionGroupId`：`import type { SessionGroup, SessionGroupId, SessionItem } from '../codex/types';`

`getChildren`：

```ts
      if (element?.kind === 'group') {
        return element.group.sessions.map((session) => toItemNode(session, element.group.id));
      }
```

`getTreeItem` 的图标行：

```ts
      item.iconPath = new vscode.ThemeIcon(
        node.session.running ? 'loading~spin' : node.session.open ? 'window' : 'comment-discussion',
      );
```

- [ ] **Step 4: 运行测试确认 PASS（绿）**

Run: `pnpm test -- treeProvider` → 7 passed。
Run: `pnpm typecheck` → 绿。

人工核对（不改文件，D22）：`package.json:119-127` 的 pin `when` 是 `viewItem =~ /^session$/ || viewItem == session.open`、unpin 是 `viewItem == session.pinned`——新优先级下，已打开且已置顶的条目 contextValue 变成 `session.pinned`，正好只给「取消置顶」，语义正确。

- [ ] **Step 5: 更新状态文件**

`test-plan.md` 的 T-025..T-028 行尾各追加 ` ✅ PASS`；`plan-ready.md` 的 Task 5 checkbox 改 `[x]`。

- [ ] **Step 6: Commit**

```bash
git add src/ui/treeProvider.ts test/unit/treeProvider.test.ts openspec/changes/add-session-running-and-pin-indicators/test-plan.md openspec/changes/add-session-running-and-pin-indicators/plan-ready.md
git commit -m "feat(ui): per-group node ids, running spinner and pin marker"
```

---

### Task 6: 运行状态追踪器（监听 + 去抖 + 轮询兜底）

**Files:**
- Create: `src/session/runningTracker.ts`
- Test: `test/unit/runningTracker.test.ts`（补全 T-016 / T-017 / T-019 / T-020 / T-021 / T-029 六个桩；T-018 留到 Task 7）

**Interfaces:**
- Consumes: `selectCandidates` / `computeRunningIds` / `DEFAULT_STALE_SECONDS`（Task 3）、`Thread` / `Turn`（Task 1）
- Produces:
  - `interface WatcherHandle { close(): void }`
  - `interface RunningTrackerDeps { scanHeldRollouts(): Map<string, number> | null; listTurns(threadId: string): Promise<Turn | undefined>; watch(path: string, onChange: () => void): WatcherHandle; onChange(runningIds: Set<string>): void; now?(): number; debounceMs?: number; pollSeconds?: number; staleSeconds?: number }`
  - `interface RunningTracker { update(threads: Thread[]): void; snapshot(): Set<string>; dispose(): void }`
  - `createRunningTracker(deps: RunningTrackerDeps): RunningTracker`

**测试驱动方式：** 定时器用 `vi.useFakeTimers()` 驱动（模块内部直接用全局 `setTimeout` / `setInterval`），`watch` / `listTurns` / `scanHeldRollouts` 全部注入。每次推进定时器后要 `await vi.advanceTimersByTimeAsync(...)`，因为重算是异步的。

- [ ] **Step 1: 补全六个测试桩**

整份替换 `test/unit/runningTracker.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Thread, Turn } from '../../src/codex/types';
import { createRunningTracker, type WatcherHandle } from '../../src/session/runningTracker';
import { makeThread, makeTurn } from '../helpers/fakes';

const NOW_MS = 1_789_970_400_000;
const DEBOUNCE = 300;

function thread(id: string): Thread {
  return makeThread({
    id,
    updatedAt: Math.floor(NOW_MS / 1000),
    path: `/sessions/rollout-2026-09-21T13-08-48-${id}.jsonl`,
  });
}

const runningTurn = (): Turn => makeTurn({ id: 'turn-1', status: 'interrupted', completedAt: null });
const doneTurn = (): Turn => makeTurn({ id: 'turn-1', status: 'completed', completedAt: 100 });

interface Harness {
  watchers: Map<string, { handle: WatcherHandle; fire(): void; closed: boolean }>;
  notifications: Array<Set<string>>;
  watchCalls: string[];
}

function harness(options: {
  held?: () => Map<string, number> | null;
  turns?: (threadId: string) => Promise<Turn | undefined>;
  watchThrows?: boolean;
  pollSeconds?: number;
}) {
  const state: Harness = { watchers: new Map(), notifications: [], watchCalls: [] };

  const tracker = createRunningTracker({
    scanHeldRollouts: options.held ?? (() => new Map([['t1', 4242]])),
    listTurns: options.turns ?? (async () => runningTurn()),
    watch(path: string, onChange: () => void): WatcherHandle {
      state.watchCalls.push(path);
      if (options.watchThrows) throw new Error('EMFILE: too many open files');
      const entry = {
        handle: {
          close() {
            entry.closed = true;
          },
        },
        fire: onChange,
        closed: false,
      };
      state.watchers.set(path, entry);
      return entry.handle;
    },
    onChange: (ids) => state.notifications.push(ids),
    now: () => NOW_MS,
    debounceMs: DEBOUNCE,
    pollSeconds: options.pollSeconds ?? 5,
    staleSeconds: 300,
  });

  return { tracker, state };
}

describe('runningTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recomputes_and_notifies_after_rollout_write', async () => {
    let turn: Turn = doneTurn();
    const { tracker, state } = harness({ turns: async () => turn });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(state.notifications).toHaveLength(0);
    expect(tracker.snapshot().has('t1')).toBe(false);

    // rollout 文件被写入 → watcher 触发 → 重算 → 集合变化 → 回调
    turn = runningTurn();
    state.watchers.get('/sessions/rollout-2026-09-21T13-08-48-t1.jsonl')!.fire();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(state.notifications).toHaveLength(1);
    expect([...state.notifications[0]!]).toEqual(['t1']);
    expect(tracker.snapshot().has('t1')).toBe(true);

    tracker.dispose();
  });

  it('debounces_multiple_writes_into_one_notification', async () => {
    const { tracker, state } = harness({});

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(state.notifications).toHaveLength(1); // 首轮：空 → {t1}

    const listTurns = vi.fn(async () => doneTurn());
    const watcher = state.watchers.get('/sessions/rollout-2026-09-21T13-08-48-t1.jsonl')!;
    // 一次回合里 rollout 会被写很多行；每行都重算一次会把 app-server 打满
    watcher.fire();
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
    watcher.fire();
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
    watcher.fire();
    expect(state.notifications).toHaveLength(1); // 去抖窗口一直被刷新，还没重算

    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(state.notifications).toHaveLength(1); // 状态没变，D23 不回调
    void listTurns;

    tracker.dispose();
  });

  it('falls_back_to_polling_when_watch_throws', async () => {
    let turn: Turn = doneTurn();
    const { tracker, state } = harness({ watchThrows: true, turns: async () => turn, pollSeconds: 5 });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(state.watchCalls).toContain('/sessions/rollout-2026-09-21T13-08-48-t1.jsonl');
    expect(state.watchers.size).toBe(0); // watch 建不起来
    expect(state.notifications).toHaveLength(0);

    // 没有 watcher 也必须能发现状态变化——轮询兜底把它捞回来
    turn = runningTurn();
    await vi.advanceTimersByTimeAsync(5000 + DEBOUNCE);

    expect(state.notifications).toHaveLength(1);
    expect([...state.notifications[0]!]).toEqual(['t1']);

    tracker.dispose();
  });

  it('releases_watchers_for_dropped_candidates', async () => {
    let held = new Map<string, number>([
      ['t1', 4242],
      ['t2', 4243],
    ]);
    const { tracker, state } = harness({ held: () => held });

    tracker.update([thread('t1'), thread('t2')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(state.watchers.size).toBe(2);

    // t2 的进程退出了 → 它不再是候选 → 它的 inotify 句柄必须被释放
    held = new Map([['t1', 4242]]);
    state.watchers.get('/sessions/rollout-2026-09-21T13-08-48-t1.jsonl')!.fire();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(state.watchers.get('/sessions/rollout-2026-09-21T13-08-48-t2.jsonl')!.closed).toBe(true);
    expect(state.watchers.get('/sessions/rollout-2026-09-21T13-08-48-t1.jsonl')!.closed).toBe(false);

    tracker.dispose();
  });

  it('dispose_releases_all_watchers_and_timers', async () => {
    const { tracker, state } = harness({ watchThrows: false });

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(state.watchers.size).toBe(1);

    tracker.dispose();

    // 扩展卸载后仍留着 inotify 句柄 / 定时器，是 deactivate 漏回收的经典症状
    expect([...state.watchers.values()].every((entry) => entry.closed)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    // dispose 之后的事件不得再触发任何回调
    const before = state.notifications.length;
    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 10);
    expect(state.notifications).toHaveLength(before);
  });

  it('stale_recompute_results_are_discarded', async () => {
    const pending: Array<(turn: Turn) => void> = [];
    const { tracker, state } = harness({
      turns: () => new Promise<Turn>((resolve) => pending.push(resolve)),
    });

    // 第一轮重算发出查询后挂起
    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(pending).toHaveLength(1);

    // 期间又来一次事件，第二轮查询先返回「正在跑」
    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(pending).toHaveLength(2);
    pending[1]!(runningTurn());
    await vi.advanceTimersByTimeAsync(0);

    expect([...state.notifications.at(-1)!]).toEqual(['t1']);

    // 迟到的第一轮结果说「已结束」——它比当前状态旧，必须被丢弃（D25）
    pending[0]!(doneTurn());
    await vi.advanceTimersByTimeAsync(0);

    expect(state.notifications).toHaveLength(1);
    expect(tracker.snapshot().has('t1')).toBe(true);

    tracker.dispose();
  });
});
```

- [ ] **Step 2: 运行测试确认 FAIL（红）**

Run: `pnpm test -- runningTracker`
先建空壳（`createRunningTracker` 返回 `{ update() {}, snapshot: () => new Set(), dispose() {} }`），重跑，确认六条红在断言上。贴出输出，在 `test-plan.md` 的 T-016 / T-017 / T-019 / T-020 / T-021 / T-029 行尾各追加 ` 🔴 RED`。

- [ ] **Step 3: 写最小实现**

`src/session/runningTracker.ts`：

```ts
import type { Thread, Turn } from '../codex/types';
import { DEFAULT_STALE_SECONDS, computeRunningIds, selectCandidates } from './runningState';

/**
 * Orchestrates the running-state pipeline: scan → narrow → query → compute,
 * re-run on rollout writes, debounced, with a polling fallback.
 *
 * Two hazards drive the shape of this module:
 *  - self-excitation: `refresh → load → update → onChange → refresh` only
 *    terminates because `onChange` fires on an actual set change (D23);
 *  - out-of-order results: one recompute waits on N `thread/turns/list` round
 *    trips and can be superseded mid-flight, so every pass carries a
 *    generation number and a late result is dropped (D25).
 */

export interface WatcherHandle {
  close(): void;
}

export interface RunningTrackerDeps {
  /** `null` means this platform cannot detect ownership (non-Linux) — see D16. */
  scanHeldRollouts(): Map<string, number> | null;
  listTurns(threadId: string): Promise<Turn | undefined>;
  /** May throw (EMFILE, network filesystems); the tracker then polls instead. */
  watch(path: string, onChange: () => void): WatcherHandle;
  onChange(runningIds: Set<string>): void;
  now?(): number;
  debounceMs?: number;
  /** `0` disables the polling fallback. */
  pollSeconds?: number;
  staleSeconds?: number;
}

export interface RunningTracker {
  /** Feed the latest thread list; schedules a debounced recompute. */
  update(threads: Thread[]): void;
  snapshot(): Set<string>;
  dispose(): void;
}

export const DEFAULT_DEBOUNCE_MS = 300;
export const DEFAULT_POLL_SECONDS = 5;
/** Keeps one burst of `thread/turns/list` from saturating the app-server. */
const MAX_CONCURRENT_QUERIES = 4;

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

async function mapWithLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export function createRunningTracker(deps: RunningTrackerDeps): RunningTracker {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const pollMs = (deps.pollSeconds ?? DEFAULT_POLL_SECONDS) * 1000;
  const staleSeconds = deps.staleSeconds ?? DEFAULT_STALE_SECONDS;
  const now = deps.now ?? (() => Date.now());

  const watchers = new Map<string, WatcherHandle>();
  let threads: Thread[] = [];
  let running = new Set<string>();
  let generation = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  function startPolling(): void {
    if (disposed || pollTimer || pollMs <= 0) return;
    pollTimer = setInterval(schedule, pollMs);
  }

  function armWatchers(candidates: Thread[]): void {
    if (disposed) return;
    const wanted = new Set<string>();
    for (const thread of candidates) if (thread.path) wanted.add(thread.path);

    for (const [path, handle] of [...watchers]) {
      if (wanted.has(path)) continue;
      try {
        handle.close();
      } catch {
        // A watcher whose file already vanished throws on close; nothing to do.
      }
      watchers.delete(path);
    }

    for (const path of wanted) {
      if (watchers.has(path)) continue;
      try {
        watchers.set(path, deps.watch(path, schedule));
      } catch {
        startPolling();
      }
    }
  }

  function schedule(): void {
    if (disposed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void recompute();
    }, debounceMs);
  }

  async function recompute(): Promise<void> {
    if (disposed) return;
    const pass = ++generation;

    const heldRollouts = deps.scanHeldRollouts();
    const nowSeconds = Math.floor(now() / 1000);
    const candidates = selectCandidates({ threads, heldRollouts, nowSeconds, staleSeconds });
    armWatchers(candidates);

    const turns = new Map<string, Turn | undefined>();
    await mapWithLimit(candidates, MAX_CONCURRENT_QUERIES, async (thread) => {
      try {
        turns.set(thread.id, await deps.listTurns(thread.id));
      } catch {
        // D24: one failed query means "not running", not a broken tree.
        turns.set(thread.id, undefined);
      }
    });

    if (disposed || pass !== generation) return;

    const next = computeRunningIds({
      threads: candidates,
      turns,
      heldRollouts,
      nowSeconds,
      staleSeconds,
    });
    if (sameSet(next, running)) return;
    running = next;
    deps.onChange(new Set(next));
  }

  return {
    update(nextThreads: Thread[]): void {
      if (disposed) return;
      threads = nextThreads;
      schedule();
    },

    snapshot(): Set<string> {
      return new Set(running);
    },

    dispose(): void {
      disposed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = undefined;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
      for (const handle of watchers.values()) {
        try {
          handle.close();
        } catch {
          // best effort
        }
      }
      watchers.clear();
    },
  };
}
```

- [ ] **Step 4: 运行测试确认 PASS（绿）**

Run: `pnpm test -- runningTracker` → 6 passed、1 failed（`does_not_notify_when_running_set_unchanged` 仍是 Task 7 的桩）。
Run: `pnpm typecheck` → 绿。

- [ ] **Step 5: 更新状态文件**

`test-plan.md` 的 T-016 / T-017 / T-019 / T-020 / T-021 / T-029 行尾各追加 ` ✅ PASS`；`plan-ready.md` 的 Task 6 checkbox 改 `[x]`。

- [ ] **Step 6: Commit**

```bash
git add src/session/runningTracker.ts test/unit/runningTracker.test.ts openspec/changes/add-session-running-and-pin-indicators/test-plan.md openspec/changes/add-session-running-and-pin-indicators/plan-ready.md
git commit -m "feat(session): running tracker with debounced watch and polling fallback"
```

---

### Task 7: 接线、自激防护与配置项

**Files:**
- Modify: `src/extension.ts`（import 区 1-12、模块级句柄 14-15、`load` 80-94、`provider` 96、subscriptions 120-171、`deactivate` 180-185）
- Modify: `package.json`（`contributes.configuration.properties`，`codexHelper.autoRefreshSeconds` 之后）
- Test: `test/unit/runningTracker.test.ts::does_not_notify_when_running_set_unchanged`（T-018）

**Interfaces:**
- Consumes: `createRunningTracker`（Task 6）、`scanHeldRollouts`（Task 2）、`ThreadApi.listTurns`（Task 1）、`buildSessionGroups({ runningIds })`（Task 4）

- [ ] **Step 1: 补全 T-018 的测试桩**

`refresh → load → tracker.update → onChange → refresh` 是一个闭环；D23 是它唯一的收敛保证。替换桩体：

```ts
  it('does_not_notify_when_running_set_unchanged', async () => {
    const { tracker, state } = harness({});

    tracker.update([thread('t1')]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(state.notifications).toHaveLength(1);
    expect([...state.notifications[0]!]).toEqual(['t1']);

    // 模拟 refresh → load → update 的回环：状态没变就不能再回调，
    // 否则 onChange → refresh → load → update 会无限自激（D23）
    for (let round = 0; round < 5; round += 1) {
      tracker.update([thread('t1')]);
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    }

    expect(state.notifications).toHaveLength(1);
    expect(tracker.snapshot().has('t1')).toBe(true);

    tracker.dispose();
  });
```

- [ ] **Step 2: 运行测试确认 FAIL / 确认已绿**

Run: `pnpm test -- runningTracker`

D23 的实现（`sameSet` 短路）已在 Task 6 落地，因此本条大概率直接绿。**这不满足 Step 2 的红证据要求**，必须先证明这条断言有失败能力：临时把 `runningTracker.ts` 里的 `if (sameSet(next, running)) return;` 注释掉，重跑确认 T-018 红（`expected 6 to be 1`），贴出输出，在 `test-plan.md` 的 `T-018` 行尾追加 ` 🔴 RED`，**然后把那行改回来**。

- [ ] **Step 3: 写实现（接线 + 配置项）**

`src/extension.ts` — import 区补：

```ts
import { readFileSync, readdirSync, readlinkSync, watch } from 'node:fs';
import { scanHeldRollouts } from './session/processScan';
import { createRunningTracker, type RunningTracker } from './session/runningTracker';
```

模块级句柄加一个：

```ts
let runningTracker: RunningTracker | undefined;
```

在 `const provider = createSessionTreeProvider({ load });` **之前**声明 tracker 句柄、之后构造它（`load` 里要读 `tracker`，`onChange` 里要用 `provider`，所以用 `let` + 后赋值）：

```ts
  let tracker: RunningTracker | undefined;

  async function load(): Promise<SessionGroup[]> {
    const page = await api().listThreads({
      searchTerm: filter,
      cwd: workspaceCwd(),
      cursor: null,
    });
    threads = page.data;
    cursor = page.nextCursor;
    // 喂最新的线程列表；tracker 只在运行集合真的变化时才回调（D23），
    // 所以这条 refresh → load → update 的回环一轮就收敛。
    tracker?.update(threads);
    return buildSessionGroups({
      threads,
      openTabs: openTabs(),
      pinnedIds: pinStore.list(),
      runningIds: tracker?.snapshot() ?? null,
      filter,
    });
  }

  const provider = createSessionTreeProvider({ load });

  if (configuration().get<boolean>('showRunningIndicator') ?? true) {
    tracker = createRunningTracker({
      // 归属探测只在 Linux 可用；其他平台返回 null 走时间阈值降级（D16）。
      scanHeldRollouts: () =>
        process.platform === 'linux'
          ? scanHeldRollouts({ fs: { readdirSync, readlinkSync, readFileSync } })
          : null,
      listTurns: (threadId: string) => api().listTurns(threadId),
      watch: (path: string, onChange: () => void) => {
        const watcher = watch(path, onChange);
        return { close: () => watcher.close() };
      },
      onChange: () => provider.refresh(),
      pollSeconds: configuration().get<number>('runningPollSeconds') ?? 5,
      staleSeconds: configuration().get<number>('runningStaleSeconds') ?? 300,
    });
    runningTracker = tracker;
  }
```

`deactivate`：

```ts
export function deactivate(): void {
  if (autoRefresh) clearInterval(autoRefresh);
  autoRefresh = undefined;
  // inotify 句柄与轮询定时器不回收会比扩展活得更久。
  runningTracker?.dispose();
  runningTracker = undefined;
  appServer?.dispose();
  appServer = undefined;
}
```

`package.json` — 在 `codexHelper.autoRefreshSeconds` 之后加三个属性：

```json
        "codexHelper.showRunningIndicator": {
          "type": "boolean",
          "default": true,
          "description": "在正在执行回合的会话上显示运行图标。"
        },
        "codexHelper.runningStaleSeconds": {
          "type": "number",
          "default": 300,
          "description": "运行状态的过期阈值（秒）。仅用于无法探测进程归属的平台（macOS / Windows）：超过该时长没有写入的会话不再显示为运行中。Linux 上由进程归属判定，不使用该阈值。"
        },
        "codexHelper.runningPollSeconds": {
          "type": "number",
          "default": 5,
          "description": "文件监听不可用时的兜底轮询间隔（秒）。0 表示关闭兜底轮询。"
        }
```

- [ ] **Step 4: 运行测试确认 PASS（绿）**

Run: `pnpm test` → 全量绿。
Run: `pnpm typecheck` → 绿。
Run: `pnpm build` → 成功。

- [ ] **Step 5: 更新状态文件**

`test-plan.md` 的 `T-018` 行尾追加 ` ✅ PASS`；`plan-ready.md` 的 Task 7 checkbox 改 `[x]`。

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts package.json test/unit/runningTracker.test.ts openspec/changes/add-session-running-and-pin-indicators/test-plan.md openspec/changes/add-session-running-and-pin-indicators/plan-ready.md
git commit -m "feat(extension): wire the running tracker and add its settings"
```

---

## 全量回归与收尾

- [ ] `pnpm test` — 全部通过，既有 42 条无回归，新增 31 条全绿（总计 71 条：42 + 31 − 2 条被取代的删除）
- [ ] `pnpm typecheck` — 绿
- [ ] `pnpm build` — 成功
- [ ] `test-plan.md` 的 31 行全部带 `🔴 RED` + `✅ PASS`
- [ ] `plan-ready.md` 的 7 个 checkbox 全部 `[x]`
- [ ] 本变更全部在同一工作区的 TypeScript 代码内，无跨仓库/跨前后端遗留
- [ ] 切阶段：`printf '%s\n' '{"version":1,"change":"add-session-running-and-pin-indicators","phase":"verify"}' > .openflow/phase && rm -f .openflow/building`

## 人工验收（非自动化，build 完成后在真实窗口确认）

1. 打开一个 Codex 会话并发起一条耗时回合 → 侧边栏该条目出现运行图标；回合结束后图标恢复。
2. 置顶一个会话再打开它 → 「已打开」与「置顶」两组各有一行，两行都带 `📌`，右键都给「取消置顶」。
3. 取消置顶 → 「置顶」组那行消失，「已打开」组那行保留且 `📌` 消失。

---

## Amendment 2026-09-21: 条目描述由首条消息改为会话目录

Task 1–7 已完成并 commit。以下为 amend 追加的 Task 8。规格依据：design §6.3 + D26/D27，spec.md 的 `Scenario: 条目描述显示会话所在目录的末级名称` / `Scenario: 没有目录信息的会话不显示描述`。

### Task 8: description 从 preview 改为 cwd 末级目录名

**Files:**
- Modify: `src/ui/treeProvider.ts`（`toItemNode` 的 `preview` 常量与 `description` 组装，约 :84-86）
- Test: `test/unit/treeProvider.test.ts`（重写 T-027，新增 T-030 / T-031 / INV-003）

**Interfaces:**
- Consumes: `SessionItem.cwd`（`string | null`，已存在）
- Produces: `cwdBasename(cwd: string | null | undefined): string | undefined`（从 `treeProvider.ts` 导出，供 INV-003 直接驱动边界输入）

**约定：** `cwdBasename` 同时吃 `/` 与 `\` 分隔符、忽略尾随分隔符；根目录与空串返回 `undefined`（等同「没有目录部分」）。`description` = `pinned ? \`📌 ${base ?? ''}\`.trimEnd() : base`。

- [ ] **Step 1: 重写 T-027 + 写 T-030 / T-031**

`pinned_session_description_starts_with_pin_marker` 改为：

```ts
  it('pinned_session_description_starts_with_pin_marker', async () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 'pin-1', name: '钉住的', preview: '钉住的预览', cwd: '/home/hk/meicai/order' }),
        makeThread({ id: 'plain', name: '普通的', preview: '普通的预览', cwd: '/home/hk/github/codex-cli' }),
      ],
      openTabs: [],
      pinnedIds: ['pin-1'],
    });

    const pinned = await sessionNodes(groups, 'pinned');
    const history = await sessionNodes(groups, 'history');

    // 图标位被运行状态占着，置顶只能落在 description 上（D21）
    expect(pinned.nodes[0]!.description).toBe('📌 order');
    expect(pinned.provider.getTreeItem(pinned.nodes[0]!).description).toBe('📌 order');
    // 没置顶的条目不能平白多出一个图钉，但目录照旧显示
    expect(history.nodes[0]!.description).toBe('codex-cli');
  });
```

新增两条：

```ts
  it('description_shows_cwd_basename', async () => {
    const groups = buildSessionGroups({
      threads: [makeThread({ id: 't1', name: '价格排查', preview: '帮我看看这个报价', cwd: '/home/hk/meicai/price-research' })],
      openTabs: [],
      pinnedIds: [],
    });

    const { nodes } = await sessionNodes(groups, 'history');

    // 侧边栏窄，description 从右侧截断——完整路径会把最有辨识度的尾部切掉（D26）
    expect(nodes[0]!.description).toBe('price-research');
    // 首条消息不再出现在右侧
    expect(String(nodes[0]!.description)).not.toContain('帮我看看这个报价');
  });

  it('session_without_cwd_has_empty_description', async () => {
    // 已打开的标签对应的会话不在 thread/list 里 ⇒ cwd 为 null
    const groups = buildSessionGroups({
      threads: [],
      openTabs: [makeOpenTab('t8', '新会话'), makeOpenTab('t9', '钉住的新会话')],
      pinnedIds: ['t9'],
    });

    const { nodes } = await sessionNodes(groups, 'open');
    const descOf = (id: string) => nodes.find((node) => node.id.endsWith(id))!.description;

    expect(descOf('t8')).toBeUndefined();
    // 没有目录时置顶前缀不能拖着一个看不见的尾随空格（D27）
    expect(descOf('t9')).toBe('📌');
  });
```

INV-003（最后写）：

```ts
  // INV-003: design §6.3 的 (cwd 形态 × pinned) 8 格全组合
  it('description_matrix_holds_for_all_cwd_and_pinned_combinations', () => {
    const cwds: Array<[string | null, string | undefined]> = [
      ['/home/hk/github/vscode-codex-helper', 'vscode-codex-helper'],
      ['/home/hk/github/vscode-codex-helper/', 'vscode-codex-helper'],
      ['/', undefined],
      [null, undefined],
    ];
    let withDir = 0;
    let withoutDir = 0;

    for (const [cwd, expectedBase] of cwds) {
      // 先单独钉住取名函数本身，再钉住它被组装进 description 的结果
      expect(cwdBasename(cwd), `cwdBasename(${cwd})`).toBe(expectedBase);

      for (const pinned of [true, false]) {
        const groups = buildSessionGroups({
          threads: [makeThread({ id: 't1', name: '目标会话', cwd: cwd ?? undefined })],
          openTabs: cwd === null ? [makeOpenTab('t1', '目标会话')] : [],
          pinnedIds: pinned ? ['t1'] : [],
        });
        const row = groups.flatMap((group) => group.sessions).find((s) => s.id === 't1')!;
        const description = pinned
          ? `📌 ${cwdBasename(row.cwd) ?? ''}`.trimEnd()
          : cwdBasename(row.cwd);

        // 独立推导的期望值：不复用被测实现的组装分支
        const expected = pinned
          ? expectedBase === undefined
            ? '📌'
            : `📌 ${expectedBase}`
          : expectedBase;

        expect(description, `cwd=${cwd} pinned=${pinned}`).toBe(expected);
        // 尾随空格在 UI 里看不见，只能靠完整相等断言钉死
        expect(String(description ?? ''), `cwd=${cwd} pinned=${pinned} 尾随空白`).toBe(
          String(description ?? '').trimEnd(),
        );

        if (expectedBase === undefined) withoutDir += 1;
        else withDir += 1;
      }
    }

    // 反空转护栏：4 种 cwd 形态 × 2 种置顶状态 = 8 格，两类结论都要出现
    expect(withDir + withoutDir).toBe(8);
    expect(withDir).toBe(4);
    expect(withoutDir).toBe(4);
  });
```

- [ ] **Step 2: 运行测试确认 FAIL（红）**

Run: `npx vitest run test/unit/treeProvider.test.ts`

先只导出一个返回 `undefined` 的 `cwdBasename` 空壳，确认四条红在断言上（T-027 报 `expected '📌 钉住的预览' to be '📌 order'`）。贴出输出，在 `test-plan.md` 的 T-027 / T-030 / T-031 / INV-003 行尾各追加 ` 🔴 RED`（T-027 是重走，它的旧凭据已在 amend 中清除）。

INV-003 此时必须在**多个**格子上报失败——只红一格说明矩阵没跑满。

- [ ] **Step 3: 写最小实现**

`src/ui/treeProvider.ts`：

```ts
/**
 * Last segment of a session's working directory.
 *
 * The sidebar is narrow and `description` truncates from the right, so a full
 * path loses exactly the part that tells sessions apart (design D26). Accepts
 * both separators and ignores a trailing one; the root directory and the empty
 * string have no meaningful last segment and yield `undefined` (D27).
 */
export function cwdBasename(cwd: string | null | undefined): string | undefined {
  if (!cwd) return undefined;
  const segments = cwd.split(/[/\\]+/).filter((segment) => segment.length > 0);
  return segments.at(-1);
}
```

`toItemNode` 的两行改为：

```ts
    const base = cwdBasename(session.cwd);
    // 图标位归运行状态，置顶只能占 description 前缀（D21）。
    // 没有目录时 trimEnd 掉 `📌 ` 的尾随空格（D27）。
    const description = session.pinned ? `📌 ${base ?? ''}`.trimEnd() : base;
```

- [ ] **Step 4: 运行测试确认 PASS（绿）**

Run: `npx vitest run test/unit/treeProvider.test.ts` → 10 passed
Run: `pnpm test` → 全量绿；`pnpm typecheck`、`pnpm build` 通过

- [ ] **Step 5: 更新状态文件**

`test-plan.md` 的 T-027 / T-030 / T-031 / INV-003 行尾各追加 ` ✅ PASS`（T-027 同时清掉 `⚠️ 待更新` 标记）；`plan-ready.md` 的 Task 8 checkbox 改 `[x]`。

- [ ] **Step 6: Commit**

```bash
git add src/ui/treeProvider.ts test/unit/treeProvider.test.ts openspec/changes/add-session-running-and-pin-indicators/
git commit -m "feat(ui): show the session directory instead of its first message"
```

## 人工验收补充（amend 追加）

4. 侧边栏条目右侧显示的是会话所在目录的末级目录名；置顶的条目为 `📌 <目录名>`。
5. 打开一个服务端列表里没有的会话（新建标签）→ 该行右侧为空；把它置顶 → 右侧恰为 `📌`。
