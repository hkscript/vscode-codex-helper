# 连点「+」每次都能新开一个会话面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `codexHelper.newSession`（侧边栏 `+`）每次执行都新开一个标签页，而不是被 VS Code 的「同一 resource 只有一个自定义编辑器」折叠成无反应。

**Architecture:** `+` 不再委派 `chatgpt.newCodexPanel`；改为本插件用 `vscode.openWith` 打开 Codex 的 new-panel 路由（path 常量 `/extension/panel/new`），并在 query 上带一个每次调用独有的 nonce。path 不变 ⇒ webview 路由照旧匹配、Codex 侧仍是空白新会话面板；resource 变了 ⇒ VS Code 真的新开标签。URI 契约继续收口在 `src/codex/conversationUri.ts`。

**Tech Stack:** TypeScript + esbuild，测试用 vitest（`vscode` 由 `vitest.config.ts` alias 到 `test/helpers/fakes.ts`）。

**Spec:** `openspec/changes/fix-new-session-panel-reuse/design.md`（决策 D28–D32）、`openspec/changes/fix-new-session-panel-reuse/specs/codex-session-sidebar/spec.md`

## Global Constraints

- 每个 task 必须先写/补测试，见过红（`🔴 RED`）再写实现；`test-plan.md` 状态后缀只追加在行尾，不改选择器。
- 生产代码不许 import `vscode`：新依赖一律通过注入（`UriApi`、`createNonce`），`src/codex/types.ts` 的注释已把这条写成硬约束。
- 失败语义与既有 `src/session/opener.ts` 一致：只报错、不抛回命令层、不静默回退到别的入口。
- 单文件测试用 `npx vitest run <文件>`（`pnpm test -- <名字>` 不会过滤，见 archive lessons 坑 3）。

---

### Task 1: new-panel URI 契约

**Files:**
- Modify: `src/codex/conversationUri.ts`
- Test: `test/unit/conversationUri.test.ts`

**Interfaces:**
- Consumes: `UriApi`（`src/codex/types.ts`）、`createFakeUriApi()`（`test/helpers/fakes.ts`）
- Produces: `NEW_PANEL_PATH: string`（`'/extension/panel/new'`）、`buildNewPanelUri(uriApi: UriApi, nonce: string): UriLike`——Task 2 依赖这两个导出

- [ ] **Step 1: 写失败的测试**

在 `test/unit/conversationUri.test.ts` 的 import 里加上 `buildNewPanelUri`、`NEW_PANEL_PATH`，并在 `describe` 内追加两个用例：

```ts
  // REQ: 新建会话 / Scenario: 每次执行都打开带上本次调用独有 query 的新面板 URI
  it('new_panel_uri_uses_codex_route_with_unique_query', () => {
    const uriApi = createFakeUriApi();
    const uri = buildNewPanelUri(uriApi, 'n1');

    // path 必须逐字等于 Codex 自己的常量，否则 webview 的路由匹配不上
    expect(NEW_PANEL_PATH).toBe('/extension/panel/new');
    expect(uri.scheme).toBe('openai-codex');
    expect(uri.authority).toBe('route');
    expect(uri.path).toBe('/extension/panel/new');
    expect(uri.query).toBe('newPanel=n1');

    // 不同 nonce ⇒ 不同 resource。同一 resource 会被 VS Code 折叠成一个标签，
    // 这正是本次 bug 的成因（supportsMultipleEditorsPerDocument: false）。
    expect(buildNewPanelUri(uriApi, 'n2').query).not.toBe(uri.query);
  });

  // REQ: 新建会话 / Scenario: 带 query 的新面板 URI 不被误判为会话
  it('new_panel_uri_is_not_parsed_as_a_conversation', () => {
    const uriApi = createFakeUriApi();

    expect(parseConversationId(buildNewPanelUri(uriApi, 'n1'))).toBeNull();
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/conversationUri.test.ts`
Expected: FAIL——`buildNewPanelUri` 未导出（`is not a function` / 导入错误），而不是断言不匹配。

- [ ] **Step 3: 写最小实现**

在 `src/codex/conversationUri.ts` 里 `CODEX_CONVERSATION_VIEW_TYPE` 之后加常量，文件末尾加函数：

```ts
/**
 * Codex's own `createNewPanel()` opens this exact path (bundle: `pI()`), and
 * its custom editor provider is registered with
 * `supportsMultipleEditorsPerDocument: false` — so a constant resource can only
 * ever have one editor tab. We keep the path verbatim (the webview matches
 * routes on pathname) and carry the identity in the query instead.
 */
export const NEW_PANEL_PATH = '/extension/panel/new';
export const NEW_PANEL_QUERY_KEY = 'newPanel';

export function buildNewPanelUri(uriApi: UriApi, nonce: string): UriLike {
  return uriApi.file(NEW_PANEL_PATH).with({
    scheme: CODEX_URI_SCHEME,
    authority: CODEX_URI_AUTHORITY,
    query: `${NEW_PANEL_QUERY_KEY}=${nonce}`,
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/unit/conversationUri.test.ts`
Expected: PASS（全文件用例都绿）

- [ ] **Step 5: 更新 test-plan.md 与 plan-ready.md**

`T-001`、`T-005` 行尾追加 `🔴 RED ✅ PASS`；Task 1 的 `- [ ]` 改 `- [x]`。

---

### Task 2: 新建会话命令改为自建 URI + 接线

**Files:**
- Modify: `src/commands.ts`（`createNewSessionCommand`）、`src/extension.ts`（`activate` 的接线）、`README.md`
- Test: `test/unit/commands.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `buildNewPanelUri` / `CODEX_CONVERSATION_VIEW_TYPE`；`vscode.Uri` 与 `randomUUID()` 在 `extension.ts` 注入
- Produces: `NewSessionCommandDeps = { executeCommand, showErrorMessage, uriApi, createNonce }`

- [ ] **Step 1: 改写测试（先删被取代的用例，再写新的失败测试）**

在 `test/unit/commands.test.ts` 里删除 `calls_new_codex_panel_once`，把 `shows_error_when_new_session_command_fails` 换成 `shows_error_when_new_panel_open_fails`（新的失败来源），并新增两个用例。文件顶部 import 补 `createFakeUriApi` 与 `type UriLike`；加两个局部 helper：

```ts
function makeNewSessionDeps() {
  const calls: unknown[][] = [];
  const executeCommand = vi.fn(async (command: string, ...args: unknown[]) => {
    calls.push([command, ...args]);
  });
  const showErrorMessage = vi.fn((_message: string) => undefined);
  const nonces = ['n1', 'n2'];
  const createNonce = vi.fn(() => nonces.shift() ?? 'nX');
  return {
    deps: { executeCommand, showErrorMessage, uriApi: createFakeUriApi(), createNonce },
    calls,
    executeCommand,
    showErrorMessage,
    createNonce,
  };
}

/** VS Code 的 resource 身份：scheme/authority/path/query 全同才算同一个文档。 */
function resourceKey(uri: UriLike): string {
  return `${uri.scheme}://${uri.authority}${uri.path}?${uri.query}`;
}
```

```ts
  // REQ: 新建会话 / Scenario: 每次执行都打开带上本次调用独有 query 的新面板 URI
  it('opens_new_panel_uri_with_injected_nonce', async () => {
    const { deps, calls, executeCommand, showErrorMessage } = makeNewSessionDeps();
    const newSession = createNewSessionCommand(deps);

    await newSession();

    expect(executeCommand).toHaveBeenCalledTimes(1);
    const [command, uri, viewType, options] = calls[0] as [string, UriLike, string, unknown];
    expect(command).toBe('vscode.openWith');
    expect(resourceKey(uri)).toBe('openai-codex://route/extension/panel/new?newPanel=n1');
    expect(viewType).toBe('chatgpt.conversationEditor');
    expect(options).toEqual({ preview: false });
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  // REQ: 新建会话 / Scenario: 连续两次执行产生两个互不相同的 URI
  it('two_invocations_open_two_distinct_uris', async () => {
    const { deps, calls, createNonce } = makeNewSessionDeps();
    const newSession = createNewSessionCommand(deps);

    await newSession();
    await newSession();

    expect(createNonce).toHaveBeenCalledTimes(2);
    const uris = calls.map((call) => call[1] as UriLike);
    // 关键断言：两次点击必须落到两个 resource，否则 VS Code 只会保留一个标签
    expect(uris.map(resourceKey)).toEqual([
      'openai-codex://route/extension/panel/new?newPanel=n1',
      'openai-codex://route/extension/panel/new?newPanel=n2',
    ]);
    expect(new Set(uris.map(resourceKey)).size).toBe(2);
    // 路由 path 不变，webview 才匹配得上
    expect(uris.map((uri) => uri.path)).toEqual(['/extension/panel/new', '/extension/panel/new']);
    // 不再委派给只能开一个的入口
    expect(calls.some((call) => call[0] === 'chatgpt.newCodexPanel')).toBe(false);
  });

  // REQ: 新建会话 / Scenario: 新建失败时提示错误
  it('shows_error_when_new_panel_open_fails', async () => {
    const { deps, showErrorMessage } = makeNewSessionDeps();
    deps.executeCommand.mockImplementation(async () => {
      throw new Error('no custom editor registered for chatgpt.conversationEditor');
    });
    const newSession = createNewSessionCommand(deps);

    // 命令本身不能把异常抛回 VS Code 命令层，否则用户只看到静默失败
    await expect(newSession()).resolves.toBeUndefined();

    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('no custom editor registered');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/commands.test.ts`
Expected: FAIL——三个新用例都因「命令仍委派 `chatgpt.newCodexPanel` / `uriApi` 未使用」而红；失败信息应指向断言（收到的 command 是 `chatgpt.newCodexPanel`），不是 import 错误。

- [ ] **Step 3: 写最小实现**

`src/commands.ts` 顶部加 import：

```ts
import { CODEX_CONVERSATION_VIEW_TYPE, buildNewPanelUri } from './codex/conversationUri';
import type { UriApi } from './codex/types';
```

把 `NewSessionCommandDeps` 与 `createNewSessionCommand` 换成（注释同步更新为新的机制说明）：

```ts
/**
 * 新建会话：本插件自己打开 Codex 的 new-panel 路由，并在 query 上带一个本次
 * 调用独有的 nonce（design D28/D29）。
 *
 * 不能再委派 `chatgpt.newCodexPanel`：它的 resource 是常量
 * `openai-codex://route/extension/panel/new`，而 Codex 注册自定义编辑器时声明
 * `supportsMultipleEditorsPerDocument: false`——同一 resource 的第二次打开只会把
 * 已有标签移过去，于是连点「+」表现为「没反应」。
 *
 * 失败只报错，绝不静默回退到别的入口（与 opener.ts 的失败语义一致）。
 */
export interface NewSessionCommandDeps {
  executeCommand(command: string, ...args: unknown[]): unknown;
  showErrorMessage(message: string): unknown;
  uriApi: UriApi;
  createNonce(): string;
}

export function createNewSessionCommand(deps: NewSessionCommandDeps): () => Promise<void> {
  return async function newSession(): Promise<void> {
    try {
      await deps.executeCommand(
        'vscode.openWith',
        buildNewPanelUri(deps.uriApi, deps.createNonce()),
        CODEX_CONVERSATION_VIEW_TYPE,
        { preview: false },
      );
    } catch (error) {
      deps.showErrorMessage(`新建会话失败：${reasonOf(error)}`);
    }
  };
}
```

`src/extension.ts`：顶部加 `import { randomUUID } from 'node:crypto';`，并把接线改为：

```ts
  const newSession = createNewSessionCommand({
    executeCommand: (command: string, ...args: unknown[]) =>
      Promise.resolve(vscode.commands.executeCommand(command, ...args)),
    showErrorMessage: (message: string) => vscode.window.showErrorMessage(message),
    uriApi: vscode.Uri,
    createNonce: () => randomUUID(),
  });
```

`README.md`：在「已知限制」处补一条——`+` 复刻了 Codex 的 new-panel 路由（`/extension/panel/new` + `newPanel` query）；若 Codex 升级后改路由或不再容忍 query，症状是 `+` 开出空白/异常页面，此时应改回委派 `chatgpt.newCodexPanel`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/unit/commands.test.ts` → PASS
Run: `pnpm test` → 全量绿
Run: `pnpm typecheck` → 无错误

- [ ] **Step 5: 更新 test-plan.md 与 plan-ready.md**

`T-002`、`T-003`、`T-004` 行尾追加 `🔴 RED ✅ PASS`；Task 2 的 `- [ ]` 改 `- [x]`。

---

### Task 3: 人工验收（非代码，verify 阶段执行）

- [ ] 连点 `+` 三次 → 三个空白新会话标签
- [ ] 在其中一个空白面板发消息 → 正常进入会话
- [ ] 关闭全部空白面板后再点 `+` → 仍能开出新的空白面板
