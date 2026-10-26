import { describe, expect, it, vi } from 'vitest';
import { createSidebarMode } from '../../src/session/sidebarMode';
import { createFakeUriApi } from '../helpers/fakes';

function makeDeps(enabled: boolean, openExternalResult = true) {
  const executeCommand = vi.fn(async (_command: string, ..._args: unknown[]) => undefined);
  const openExternal = vi.fn(async (_uri: unknown) => openExternalResult);
  return {
    deps: {
      enabled: () => enabled,
      executeCommand,
      openExternal,
      uriApi: createFakeUriApi(),
    },
    executeCommand,
    openExternal,
  };
}

describe('sidebar mode', () => {
  it('creates_a_new_session_in_the_loaded_codex_sidebar', async () => {
    const { deps, executeCommand } = makeDeps(true);
    const mode = createSidebarMode(deps);

    await expect(mode.newSession()).resolves.toBe(true);
    expect(executeCommand).toHaveBeenCalledWith('chatgpt.newChat');
  });

  it('opens_an_existing_session_through_the_codex_uri_handler', async () => {
    const { deps, openExternal } = makeDeps(true);
    const mode = createSidebarMode(deps);

    await expect(mode.openSession('conv-1')).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledTimes(1);
    const uri = openExternal.mock.calls[0]![0] as {
      toString(): string;
    };
    expect(uri.toString()).toBe('vscode://openai.chatgpt/local/conv-1');
  });

  it('does_nothing_when_editor_tab_mode_is_selected', async () => {
    const { deps, executeCommand, openExternal } = makeDeps(false);
    const mode = createSidebarMode(deps);

    await expect(mode.newSession()).resolves.toBe(false);
    await expect(mode.openSession('conv-1')).resolves.toBe(false);
    expect(executeCommand).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('falls_back_when_the_codex_uri_handler_does_not_accept_the_url', async () => {
    const { deps } = makeDeps(true, false);
    const mode = createSidebarMode(deps);

    await expect(mode.openSession('conv-1')).resolves.toBe(false);
  });
});
