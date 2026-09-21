# Codex Session Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建伴生插件 `vscode-codex-helper`，用侧边栏 TreeView 浏览 / 搜索 / 打开 / 聚焦 / 重命名 / 置顶 Codex（`openai.chatgpt`）会话。

**Architecture:** 纯逻辑模块（分帧、分组、过滤、URI 编解码、二进制定位）全部依赖注入、不 import `vscode`，可被 vitest 直接单测；触碰 VS Code API 的三个模块（`ui/treeProvider`、`commands`、`extension`）只做薄转发。会话数据经 `codex app-server` 子进程的 NDJSON JSON-RPC 获取（`thread/list`、`thread/loaded/list`、`thread/name/set`），"打开会话"走 Codex 自己 `resolveCustomEditor` 支持的内部路由 `openai-codex://route/local/<id>` + viewType `chatgpt.conversationEditor`。

**Tech Stack:** TypeScript 5.9 · esbuild 0.24 · vitest 2.1 · VS Code Extension API（`engines.vscode ^1.96.2`） · pnpm

**Spec:** `openspec/changes/add-codex-session-sidebar/specs/codex-session-sidebar/spec.md`（设计：`openspec/changes/add-codex-session-sidebar/design.md`；测试映射：`test-plan.md`；任务边界：`plan-ready.md`）

## Global Constraints

- `engines.vscode` 不低于 `^1.96.2`；`extensionDependencies: ["openai.chatgpt"]`。
- 会话 URI 必须是 `scheme=openai-codex`、`authority=route`、`path=/local/<conversationId>`；viewType 常量 `chatgpt.conversationEditor`。两者与 Codex bundle 中的 `pI()` / `dI()` 必须互逆。
- 二进制定位顺序：`codexHelper.codexExecutable` → `chatgpt.cliExecutable` → `<openai.chatgpt extensionPath>/bin/<os>-<arch>/codex`（复刻 `fh()` 映射：`linux→linux`、`x64→x86_64`、`arm64→aarch64`、`win32→windows`+`codex.exe`、`darwin→macos`）→ 抛错。
- app-server 协议是 NDJSON：每行一条 JSON-RPC 消息；必须先 `initialize` 再发业务请求；**无 `id` 的通知必须被忽略**。
- 打开失败**不回退** `chatgpt.newCodexPanel`，只弹错误。
- 置顶只存 `globalState['codexHelper.pinnedSessionIds']`（`string[]`）；`thread/metadata/update` 只能改 `gitInfo`，不可用于置顶。
- 分组优先级：已打开 > 置顶 > 历史；一个会话只出现一次；**只被置顶但服务端与标签页都查无此人的 id 丢弃**。
- 测试只能通过稳定选择器运行：`pnpm vitest run <file>::<name>`。

## 文件结构（写死，后续 task 的 Consumes 依赖此表）

| 文件 | 职责 | import vscode? |
|------|------|----------------|
| `src/codex/types.ts` | 共享类型（`UriLike`/`UriApi`/`MementoLike`/`Thread`/`ThreadListParams`/`OpenTab`/`SessionItem`/`SessionGroup`/`MementoLike`） | 否 |
| `src/codex/conversationUri.ts` | `buildConversationUri` / `parseConversationId` / 常量 | 否（注入 `UriApi`） |
| `src/codex/binary.ts` | `resolveCodexBinary` / `resolvePlatformBinDir` | 否（注入 `BinaryDeps`） |
| `src/codex/appServerClient.ts` | spawn + NDJSON 分帧 + initialize 握手 + 请求路由 + 超时 + dispose | 否（注入 `spawn`） |
| `src/codex/threadApi.ts` | `listThreads` / `listLoadedThreadIds` / `setThreadName` | 否 |
| `src/session/openTabs.ts` | `scanCodexTabs` | 否（注入判定谓词） |
| `src/session/pinStore.ts` | `createPinStore` | 否（注入 `MementoLike`） |
| `src/session/sessionStore.ts` | `buildSessionGroups` / `matchesFilter` | 否 |
| `src/session/opener.ts` | `createSessionOpener` | 否（注入 `executeCommand`） |
| `src/ui/treeProvider.ts` | `createSessionTreeProvider` | 是（TreeItem/ThemeIcon/EventEmitter） |
| `src/commands.ts` | 命令工厂 + `registerCommands` | 是 |
| `src/extension.ts` | `activate` / `deactivate` 装配 | 是 |
| `test/helpers/fakes.ts` | 测试替身 **+ vitest 的 `vscode` 模块替身** | — |

## 跨 task 接口契约（必须逐字一致）

```ts
// src/codex/types.ts
export interface UriLike { scheme: string; authority: string; path: string; query: string; }
export interface UriLikeWith extends UriLike { with(change: Partial<UriLike>): UriLike; }
export interface UriApi { file(path: string): UriLikeWith; parse(value: string): UriLikeWith; }
export interface MementoLike { get<T>(key: string): T | undefined; update(key: string, value: unknown): Thenable<void>; }
export interface Thread { id: string; name?: string | null; preview: string; cwd: string; createdAt: number; updatedAt: number; }
export interface ThreadListResponse { data: Thread[]; nextCursor: string | null; }
export interface OpenTab { id: string | null; tabLabel: string; }
export interface SessionItem { id: string; label: string; preview: string; cwd: string | null; updatedAt: number | null; pinned: boolean; open: boolean; }
export interface SessionGroup { id: 'open' | 'pinned' | 'history'; label: string; sessions: SessionItem[]; }
```

```ts
// Task1 src/codex/conversationUri.ts
export const CODEX_URI_SCHEME = 'openai-codex';
export const CODEX_URI_AUTHORITY = 'route';
export const CODEX_CONVERSATION_VIEW_TYPE = 'chatgpt.conversationEditor';
export function conversationPath(conversationId: string): string;          // `/local/<id>`
export function buildConversationUri(uriApi: UriApi, conversationId: string): UriLike;
export function parseConversationId(uri: UriLike | null | undefined): string | null;

// Task2 src/codex/binary.ts
export interface BinaryDeps {
  getConfiguration(section: string): { get<T>(key: string): T | undefined };
  getExtension(id: string): { extensionPath: string } | undefined;
}
export function resolvePlatformBinDir(platform: string, arch: string): string;   // 'bin/linux-x86_64'
export function resolveCodexBinary(deps: BinaryDeps, platform?: string, arch?: string): string;  // throws

// Task3 src/codex/appServerClient.ts
export interface AppServerClient {
  start(): Promise<{ userAgent: string | null }>;
  request<T>(method: string, params?: unknown): Promise<T>;
  dispose(): void;
  pendingCount(): number;
}
export function createAppServerClient(options: {
  binaryPath: string; spawn: SpawnLike; requestTimeoutMs?: number;
  clientInfo?: { name: string; version: string };
}): AppServerClient;

// Task4 src/codex/threadApi.ts
export interface ThreadApi {
  listThreads(query?: { searchTerm?: string | null; cwd?: string | null; cursor?: string | null }): Promise<ThreadListResponse>;
  listLoadedThreadIds(): Promise<string[]>;
  setThreadName(threadId: string, name: string): Promise<void>;
}
export function createThreadApi(client: { request<T>(method: string, params?: unknown): Promise<T> }, options?: { pageSize?: number }): ThreadApi;

// Task5 src/session/openTabs.ts
export function scanCodexTabs(tabGroups: { all: Array<{ tabs: Array<{ label: string; input: unknown }> }> }, options?: { viewType?: string; isCustomInput?: (input: unknown) => boolean }): OpenTab[];

// Task6 src/session/pinStore.ts
export const PIN_STATE_KEY = 'codexHelper.pinnedSessionIds';
export interface PinStore { list(): string[]; isPinned(id: string): boolean; pin(id: string): Promise<void>; unpin(id: string): Promise<void>; }
export function createPinStore(memento: MementoLike): PinStore;

// Task7 src/session/sessionStore.ts
export function matchesFilter(session: { id: string; label: string; preview: string }, keyword?: string | null): boolean;
export function buildSessionGroups(input: { threads: Thread[]; openTabs: OpenTab[]; pinnedIds: string[]; filter?: string | null }): SessionGroup[];

// Task8 src/session/opener.ts
export function createSessionOpener(deps: {
  executeCommand(command: string, ...args: unknown[]): Promise<unknown> | Thenable<unknown>;
  showErrorMessage(message: string): unknown;
  uriApi: UriApi;
}): { openSession(id: string): Promise<boolean> };

// Task9 src/ui/treeProvider.ts
export function createSessionTreeProvider(deps: { load(): Promise<SessionGroup[]> }): {
  getChildren(element?: unknown): Promise<unknown[]>;
  getTreeItem(node: any): any;
  refresh(): void;
  onDidChangeTreeData(cb: () => void): { dispose(): void };
};

// Task10 src/commands.ts
export function createRenameSessionCommand(deps: {
  threadApi: { setThreadName(threadId: string, name: string): Promise<void> };
  showInputBox(options?: { value?: string; prompt?: string }): Promise<string | undefined>;
  showErrorMessage(message: string): unknown;
}): (node: { sessionId?: string; label: string }) => Promise<void>;
```

---

### Task 1: 工程骨架与会话 URI 契约（含 spike 门禁）

**Files:**
- Create: `package.json`（已完成）、`tsconfig.json`、`vitest.config.ts`、`esbuild.mjs`、`.gitignore`
- Create: `src/codex/types.ts`、`src/codex/conversationUri.ts`、`src/extension.ts`、`test/helpers/fakes.ts`
- Test: `test/unit/conversationUri.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `UriLike`/`UriApi`/`MementoLike`/`Thread`/`OpenTab`/`SessionItem`/`SessionGroup`（types.ts，全任务共用）；`conversationPath`/`buildConversationUri`/`parseConversationId`/`CODEX_CONVERSATION_VIEW_TYPE`

- [ ] **Step 1: 补全 T-019 断言**：往返 `buildConversationUri(uriApi, 'abc')` → `parseConversationId(...) === 'abc'`；对 `vscode-remote://` / 错误 authority / `/extension/panel/new` 返回 `null`。
- [ ] **Step 2: 运行到 RED**：`pnpm vitest run test/unit/conversationUri.test.ts::conversation_uri_roundtrips_and_rejects_foreign_uri`（先写 `src/codex/conversationUri.ts` 的 throwing 骨架，红必须来自「行为未实现」而不是导入错误）。
- [ ] **Step 3: 实现**（与 Codex `pI()` / `dI()` 逐字对齐）：

```ts
export function buildConversationUri(uriApi: UriApi, conversationId: string): UriLike {
  return uriApi.file(conversationPath(conversationId)).with({
    scheme: CODEX_URI_SCHEME, authority: CODEX_URI_AUTHORITY, query: '',
  });
}
export function parseConversationId(uri: UriLike | null | undefined): string | null {
  if (!uri) return null;
  if (uri.scheme !== CODEX_URI_SCHEME) return null;
  if (uri.authority !== CODEX_URI_AUTHORITY) return null;
  const path = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
  const parts = path.split('/');
  if (parts.length < 2) return null;
  if (parts[0] !== 'local' && parts[0] !== 'remote') return null;
  return parts[1] || null;
}
```

- [ ] **Step 4: 运行到 GREEN**；`pnpm typecheck` 通过。
- [ ] **Step 5: 人工 spike（门禁，需 GUI）**：Extension Development Host 内执行 `vscode.openWith(buildConversationUri(Uri, '<真实会话id>'), 'chatgpt.conversationEditor', {preview:false})`，确认打开的是该历史会话；记录 `TabInputCustom.viewType` 实际取值。**本环境无 GUI，此步交由用户确认**；代码侧证据：Codex bundle 的 `resolveCustomEditor` 显式含 `path.startsWith("/local/")` 分支（`[Verified]`）。
- [ ] **Step 6: commit** `chore: scaffold extension and conversation URI contract`。

### Task 2: codex 可执行文件定位（T-001/T-002/T-034/T-003）
**Files:** Create `src/codex/binary.ts`；Test `test/unit/binary.test.ts`
**Interfaces:** Consumes `BinaryDeps`（本任务定义）；Produces `resolveCodexBinary(deps, platform?, arch?)`、`resolvePlatformBinDir`
- [ ] Step 1 补全 4 条断言（`<ext>/bin/linux-x86_64/codex`；`codexHelper.codexExecutable` 优先；`chatgpt.cliExecutable` 次之；两者皆空且无扩展时抛错且 message 含 `openai.chatgpt`）
- [ ] Step 2 运行到 RED（throwing 骨架）
- [ ] Step 3 实现（顺序 + `fh()` 映射；未知平台抛 `Unsupported platform`）
- [ ] Step 4 GREEN；Step 5 commit `feat: resolve codex binary path`

### Task 3: app-server JSON-RPC 客户端（T-004..T-010）
**Files:** Modify `src/codex/types.ts`（若需）；Create `src/codex/appServerClient.ts`；Test `test/unit/appServerClient.test.ts`
**Interfaces:** Produces `createAppServerClient({binaryPath, spawn, requestTimeoutMs, clientInfo})`，返回 `{start, request, dispose, pendingCount}`
- [ ] Step 1 补全 7 条断言（fake spawn：stdin 收写入、stdout 推 chunk；initialize 首条；跨 chunk 拼接；一 chunk 多消息；无 id 通知被忽略；error 拒绝；超时拒绝且 `pendingCount()===0`；dispose kill 且拒绝在途）
- [ ] Step 2 RED（throwing 骨架）
- [ ] Step 3 实现（`args = ['app-server']`；`stdio: ['pipe','pipe','pipe']`；NDJSON buffer 按 `\n` 切；`initialize` 用 id 1；业务请求 id 从 2 自增；超时 `Error('request timed out: <method>')`）
- [ ] Step 4 GREEN；Step 5 commit `feat: add app-server JSON-RPC client`

### Task 4: thread API 封装（T-011..T-014）
**Files:** Create `src/codex/threadApi.ts`；Test `test/unit/threadApi.test.ts`
**Interfaces:** Produces `createThreadApi(client, {pageSize})`
- [ ] Step 1 断言：`thread/list` 收到 `{limit:50, sortKey:'updated_at', sortDirection:'desc', archived:false}`；`searchTerm` 透传；`cwd` 透传；`cursor` 透传为 `nextCursor`
- [ ] Step 2 RED；Step 3 实现；Step 4 GREEN；Step 5 commit `feat: wrap thread list/loaded/rename RPC`

### Task 5: 已打开标签页扫描（T-015..T-017）
**Files:** Create `src/session/openTabs.ts`；Test `test/unit/openTabs.test.ts`
**Interfaces:** Produces `scanCodexTabs(tabGroups, options?)`
- [ ] Step 1 断言：viewType 匹配时解析出 id；非 Codex 标签被忽略；`/extension/panel/new` 之类解析不出 id 的标签保留为 `{id: null, tabLabel}`
- [ ] Step 2 RED；Step 3 实现；Step 4 GREEN；Step 5 commit `feat: scan open codex tabs`

### Task 6: 置顶存储（T-024..T-026）
**Files:** Create `src/session/pinStore.ts`；Test `test/unit/pinStore.test.ts`
**Interfaces:** Produces `createPinStore(memento)`、`PIN_STATE_KEY`
- [ ] Step 1 断言：pin 后 `globalState` 写入 `['t1']`；unpin 后移除；缺失时 `list()` 返回 `[]`
- [ ] Step 2 RED；Step 3 实现；Step 4 GREEN；Step 5 commit `feat: persist pinned sessions in global state`

### Task 7: 会话合并、分组与过滤（T-027..T-031、T-035、T-036、INV-001、INV-002）
**Files:** Create `src/session/sessionStore.ts`；Test `test/unit/sessionStore.test.ts`
**Interfaces:** Produces `buildSessionGroups(input)`、`matchesFilter(session, keyword)`
- [ ] Step 1 断言 7 个场景 + 2 条不变量（INV-001 全组合「每个 id 至多出现一次」；INV-002 「渲染出来的每一项都匹配过滤器」）
- [ ] Step 2 RED（不变量必须对**多个**组合报失败，否则说明断言写窄了）
- [ ] Step 3 实现：来源 = `threads` ∪ `openTabs`；open = `openTabs`，pinned = `pinnedIds − open`，history = `threads − open − pinned`；无 id 的标签用 `open-tab:<index>` 合成唯一 id；`label = name?.trim() || preview || tabLabel`；空分组不产出；所有分组都过 `matchesFilter`
- [ ] Step 4 GREEN；Step 5 commit `feat: merge and group sessions`

### Task 8: 会话打开器（T-018/T-020）
**Files:** Create `src/session/opener.ts`；Test `test/unit/opener.test.ts`
**Interfaces:** Produces `createSessionOpener(deps)`
- [ ] Step 1 断言：`executeCommand('vscode.openWith', <uri>, 'chatgpt.conversationEditor', {preview:false})` 四元组完全匹配；失败时 `showErrorMessage` 被调用且**从未**出现 `chatgpt.newCodexPanel`
- [ ] Step 2 RED；Step 3 实现；Step 4 GREEN；Step 5 commit `feat: open sessions via conversation URI`

### Task 9: 树视图（T-032/T-033）
**Files:** Create `src/ui/treeProvider.ts`；Test `test/unit/treeProvider.test.ts`
**Interfaces:** Produces `createSessionTreeProvider({load})`
- [ ] Step 1 断言：`load` 抛 `spawn ENOENT` 时 `getChildren()` 恰好返回 1 个错误节点且 `command.command === 'codexHelper.refresh'`；重试成功后返回分组节点
- [ ] Step 2 RED；Step 3 实现；Step 4 GREEN；Step 5 commit `feat: add session tree view`

### Task 10: 命令注册与插件装配（T-021..T-023）
**Files:** Create `src/commands.ts`（+ `src/extension.ts` 装配、`package.json` contributes、`resources/codex.svg`）；Test `test/unit/commands.test.ts`
**Interfaces:** Produces `createRenameSessionCommand(deps)`、`registerCommands(vscodeApi, deps)`
- [ ] Step 1 断言：输入 `价格排查` → `thread/name/set` 收 `{threadId:'t1', name:'价格排查'}`；取消（`undefined`）→ 不发请求；RPC 抛错 → `showErrorMessage`
- [ ] Step 2 RED；Step 3 实现 + `contributes`（viewsContainers/views/commands/menus/configuration）
- [ ] Step 4 GREEN + `pnpm run build` + `pnpm vitest run`（38 全绿）
- [ ] Step 5 commit `feat: register commands and wire extension`

## Self-Review

- **Spec 覆盖**：36 个 scenario + 2 条不变量全部映射到 task（见 plan-ready.md 的 `Test cases:` 行）；验收条件 1–7 的代码路径分别落在 Task 7（1、2）、Task 8（3）、Task 5+7（4）、Task 10（5）、Task 6+7（6）、Task 9（7）。
- **占位符扫描**：每个 task 都给出选择器、RED/GREEN 命令与关键实现要点；核心算法（URI 编解码、分帧、分组）给出成段代码。
- **类型一致性**：本文件「跨 task 接口契约」一节即唯一真源，后续 task 必须逐字复用它定义的名称与参数。
