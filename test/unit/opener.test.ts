import { describe, expect, it, vi } from 'vitest';
import type { UriLike } from '../../src/codex/types';
import { createSessionOpener } from '../../src/session/opener';
import { createFakeUriApi } from '../helpers/fakes';

const uriApi = createFakeUriApi();

describe('opener', () => {
  it('opens_session_with_conversation_uri_and_view_type', async () => {
    const calls: unknown[][] = [];
    const opener = createSessionOpener({
      executeCommand: async (command: string, ...args: unknown[]) => {
        calls.push([command, ...args]);
      },
      showErrorMessage: () => undefined,
      uriApi,
    });

    await expect(opener.openSession('conv-42')).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('vscode.openWith');
    const uri = calls[0]![1] as UriLike;
    expect(uri.scheme).toBe('openai-codex');
    expect(uri.authority).toBe('route');
    expect(uri.path).toBe('/local/conv-42');
    expect(calls[0]![2]).toBe('chatgpt.conversationEditor');
    expect(calls[0]![3]).toEqual({ preview: false });
  });

  it('shows_error_and_never_creates_new_panel_on_open_failure', async () => {
    const executeCommand = vi.fn(async (_command: string, ..._args: unknown[]) => {
      throw new Error('no custom editor registered for openai-codex://route/local/conv-42');
    });
    const showErrorMessage = vi.fn((_message: string) => undefined);
    const opener = createSessionOpener({ executeCommand, showErrorMessage, uriApi });

    await expect(opener.openSession('conv-42')).resolves.toBe(false);

    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    // 错误信息必须能指向具体会话，否则用户无从下手
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('conv-42');

    // 绝不回退成「新建会话」：静默开一个空会话比失败更有害（D9）
    const issued = executeCommand.mock.calls.map((call) => call[0]);
    expect(issued).not.toContain('chatgpt.newCodexPanel');
  });

  // REQ: 会话打开与聚焦 / Scenario: 已打开的会话按它自己的标签 resource 打开
  it('reveals_open_tab_with_its_own_resource', async () => {
    const calls: unknown[][] = [];
    const opener = createSessionOpener({
      executeCommand: async (command: string, ...args: unknown[]) => {
        calls.push([command, ...args]);
      },
      showErrorMessage: () => undefined,
      uriApi,
    });
    const tabUri = uriApi
      .file('/local/conv-1')
      .with({ scheme: 'openai-codex', authority: 'route', query: 'projectId=p1' }) as UriLike;

    await expect(opener.revealTab(tabUri)).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('vscode.openWith');
    // 必须是该标签自己的 resource 原对象：重拼会丢掉 query/远端，也就聚焦不到那个标签
    expect(calls[0]![1]).toBe(tabUri);
    expect(calls[0]![2]).toBe('chatgpt.conversationEditor');
    expect(calls[0]![3]).toEqual({ preview: false });
  });

  // REQ: 会话打开与聚焦 / Scenario: 打开标签 resource 失败时报错且不新建
  it('shows_error_and_never_creates_new_panel_when_revealing_tab', async () => {
    const executeCommand = vi.fn(async (_command: string, ..._args: unknown[]) => {
      throw new Error('no custom editor registered for chatgpt.conversationEditor');
    });
    const showErrorMessage = vi.fn((_message: string) => undefined);
    const opener = createSessionOpener({ executeCommand, showErrorMessage, uriApi });
    const tabUri = uriApi
      .file('/local/conv-1')
      .with({ scheme: 'openai-codex', authority: 'route', query: '' }) as UriLike;

    await expect(opener.revealTab(tabUri)).resolves.toBe(false);

    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('无法打开 Codex 标签页');
    expect(String(showErrorMessage.mock.calls[0]![0])).toContain('no custom editor registered');
    // 绝不回退成「新建会话」（D9/D30）
    expect(executeCommand.mock.calls.map((call) => call[0])).not.toContain('chatgpt.newCodexPanel');
  });
});
