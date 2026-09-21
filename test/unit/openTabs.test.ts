import { describe, expect, it } from 'vitest';
import { scanCodexTabs, selectTabsForConversation } from '../../src/session/openTabs';
import { createFakeUriApi } from '../helpers/fakes';

const uriApi = createFakeUriApi();
const codexUri = (path: string, query = '') =>
  uriApi.file(path).with({ scheme: 'openai-codex', authority: 'route', query });
const conversationInput = (id: string, query = '') => ({
  uri: codexUri(`/local/${id}`, query),
  viewType: 'chatgpt.conversationEditor',
});

describe('openTabs', () => {
  it('scans_codex_tab_and_parses_conversation_id', () => {
    const first = conversationInput('conv-1');
    const second = conversationInput('conv-2');
    const tabGroups = {
      all: [
        { tabs: [{ label: '价格排查', input: first }] },
        {
          tabs: [
            { label: '代码审查', input: second },
            { label: 'README.md', input: { uri: uriApi.file('/repo/README.md') } },
          ],
        },
      ],
    };

    expect(scanCodexTabs(tabGroups)).toEqual([
      { id: 'conv-1', tabLabel: '价格排查', uri: first.uri },
      { id: 'conv-2', tabLabel: '代码审查', uri: second.uri },
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

  // REQ: 已打开标签识别 / Scenario: 尚未绑定会话的新面板标签被忽略
  it('drops_tab_without_conversation_id', () => {
    const tabGroups = {
      all: [
        {
          tabs: [
            {
              label: 'Codex',
              input: {
                uri: codexUri('/extension/panel/new', 'newPanel=n1'),
                viewType: 'chatgpt.conversationEditor',
              },
            },
          ],
        },
      ],
    };

    // 未绑定会话的面板没有会话身份：不进扫描结果，也就永远不会变成树里的一行
    // （旧实现给它合成 open-tab:0，点一下就变成打开一个不存在的会话）
    expect(scanCodexTabs(tabGroups)).toEqual([]);
  });

  // REQ: 已打开标签识别 / Scenario: 保留每个标签页自己的 resource
  it('keeps_each_tab_own_resource', () => {
    const withQuery = conversationInput('conv-1', 'projectId=p1');
    const remote = {
      uri: codexUri('/remote/conv-r'),
      viewType: 'chatgpt.conversationEditor',
    };
    const tabGroups = {
      all: [{ tabs: [{ label: 'A', input: withQuery }, { label: 'B', input: remote }] }],
    };

    const scanned = scanCodexTabs(tabGroups);

    // path 与 query 都必须原样保留：聚焦一个已打开的标签只能靠它自己的 resource
    expect(scanned.map((tab) => tab.uri)).toEqual([withQuery.uri, remote.uri]);
    expect(scanned[0]!.uri.query).toBe('projectId=p1');
    expect(scanned[1]!.uri.path).toBe('/remote/conv-r');
  });

  // REQ: 会话归档与删除 / Scenario: 删除只关闭被删会话自己的标签（标签定位）
  it('selects_open_tabs_of_a_conversation', () => {
    const tabGroups = {
      all: [
        {
          tabs: [
            { label: 'A', input: conversationInput('conv-1'), handle: { id: 'tab-a' } },
            { label: 'B', input: conversationInput('conv-2'), handle: { id: 'tab-b' } },
          ],
        },
        {
          tabs: [
            // 同一个会话在另一个分组里也开着（多标签）⇒ 两个句柄都要被选中
            { label: 'A again', input: conversationInput('conv-1'), handle: { id: 'tab-c' } },
            { label: 'README', input: { uri: uriApi.file('/repo/README.md') }, handle: { id: 'tab-d' } },
          ],
        },
      ],
    };

    expect(selectTabsForConversation(tabGroups, 'conv-1')).toEqual([{ id: 'tab-a' }, { id: 'tab-c' }]);
    // 没开着的会话 ⇒ 一个都不关
    expect(selectTabsForConversation(tabGroups, 'conv-9')).toEqual([]);
  });
});
