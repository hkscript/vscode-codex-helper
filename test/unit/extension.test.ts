import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../../src/extension';
import { createFakeMemento, createFakeUriApi } from '../helpers/fakes';

const uriApi = createFakeUriApi();

/** `activate()` 需要的最小 ExtensionContext（只用到 globalState / subscriptions / 版本号）。 */
function makeContext() {
  return {
    globalState: createFakeMemento(),
    subscriptions: [] as unknown[],
    extension: { packageJSON: { version: '0.0.0-test' } },
  };
}

/** 取出 `activate()` 注册的某个命令处理器（接线测试的入口）。 */
function activatedHandler(command: string): (node?: unknown) => Promise<unknown> {
  const register = vscode.commands.registerCommand as unknown as {
    mock: { calls: Array<[string, (node?: unknown) => Promise<unknown>]> };
  };
  const hit = register.mock.calls.find((call) => call[0] === command);
  if (!hit) throw new Error(`没有注册命令：${command}`);
  return hit[1];
}

describe('extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // REQ: 会话打开与聚焦 / Scenario: 已打开的会话按它自己的标签 resource 打开（接线层）
  it('open_session_command_prefers_the_tab_resource', async () => {
    activate(makeContext() as never);

    const openSession = activatedHandler('codexHelper.openSession');
    const tabUri = uriApi
      .file('/local/conv-1')
      .with({ scheme: 'openai-codex', authority: 'route', query: 'projectId=p1' });

    await openSession({ sessionId: 'conv-1', tabUri, archived: false });

    // 必须原样把该标签自己的 resource 交给 openWith：重拼会丢掉 query，也就聚焦不到
    // 那个已经打开的标签（旧接线正是用 sessionId 重拼，生产日志里表现为新开标签）
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      tabUri,
      'chatgpt.conversationEditor',
      { preview: false },
    );
  });

  it('archive_and_unarchive_refresh_without_closing_tabs', () => {
    expect.fail('TODO: T-034 由 build Task 10 实现');
  });

  it('delete_closes_only_the_matching_tab', () => {
    expect.fail('TODO: T-035 由 build Task 10 实现');
  });

  it('destructive_actions_never_ask_and_only_delete_closes_tabs', () => {
    expect.fail('TODO: INV-004 由 build Task 10 实现');
  });
});
