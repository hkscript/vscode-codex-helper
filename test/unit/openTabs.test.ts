import { describe, expect, it } from 'vitest';
import { scanCodexTabs } from '../../src/session/openTabs';
import { createFakeUriApi } from '../helpers/fakes';

const uriApi = createFakeUriApi();
const conversationInput = (id: string) => ({
  uri: uriApi.file(`/local/${id}`).with({ scheme: 'openai-codex', authority: 'route' }),
  viewType: 'chatgpt.conversationEditor',
});

describe('openTabs', () => {
  it('scans_codex_tab_and_parses_conversation_id', () => {
    const tabGroups = {
      all: [
        { tabs: [{ label: '价格排查', input: conversationInput('conv-1') }] },
        {
          tabs: [
            { label: '代码审查', input: conversationInput('conv-2') },
            { label: 'README.md', input: { uri: uriApi.file('/repo/README.md') } },
          ],
        },
      ],
    };

    expect(scanCodexTabs(tabGroups)).toEqual([
      { id: 'conv-1', tabLabel: '价格排查' },
      { id: 'conv-2', tabLabel: '代码审查' },
    ]);
  });

  it('ignores_non_codex_tabs', () => {
    const tabGroups = {
      all: [
        {
          tabs: [
            {
              label: 'Preview',
              input: { uri: uriApi.file('/repo/README.md'), viewType: 'vscode.markdown.preview.editor' },
            },
            // 非 custom editor 的输入（没有 viewType）也不能被误判
            { label: 'extension.ts', input: { uri: uriApi.file('/repo/src/extension.ts') } },
            { label: 'Terminal', input: null },
          ],
        },
      ],
    };

    expect(scanCodexTabs(tabGroups)).toEqual([]);
    expect(scanCodexTabs({ all: [] })).toEqual([]);
  });

  it('keeps_new_panel_tab_with_null_conversation_id', () => {
    const tabGroups = {
      all: [
        {
          tabs: [
            {
              label: 'New chat',
              input: {
                uri: uriApi
                  .file('/extension/panel/new')
                  .with({ scheme: 'openai-codex', authority: 'route' }),
                viewType: 'chatgpt.conversationEditor',
              },
            },
          ],
        },
      ],
    };

    // 刚新建、还没绑定会话的标签必须留在「已打开」里，否则用户刚开的标签会在树里消失
    expect(scanCodexTabs(tabGroups)).toEqual([{ id: null, tabLabel: 'New chat' }]);
  });
});
