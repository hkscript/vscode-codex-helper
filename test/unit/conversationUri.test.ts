import { describe, expect, it } from 'vitest';
import {
  NEW_PANEL_PATH,
  buildConversationUri,
  buildNewPanelUri,
  conversationPath,
  parseConversationId,
} from '../../src/codex/conversationUri';
import { createFakeUriApi } from '../helpers/fakes';

describe('conversationUri', () => {
  it('conversation_uri_roundtrips_and_rejects_foreign_uri', () => {
    const uriApi = createFakeUriApi();

    // 编码规则必须与 Codex 的 pI() 逐字一致
    const uri = buildConversationUri(uriApi, 'conv-42');
    expect(uri.scheme).toBe('openai-codex');
    expect(uri.authority).toBe('route');
    expect(uri.path).toBe('/local/conv-42');
    expect(conversationPath('conv-42')).toBe('/local/conv-42');

    // 编解码互逆
    expect(parseConversationId(uri)).toBe('conv-42');

    // remote 路由同样解析出 id
    const remoteUri = uriApi
      .file('/remote/r-1')
      .with({ scheme: 'openai-codex', authority: 'route' });
    expect(parseConversationId(remoteUri)).toBe('r-1');

    // 外来 URI / 结构不符一律返回 null，绝不猜一个 id 出来
    expect(parseConversationId(uriApi.file('/local/conv-42'))).toBeNull();
    expect(
      parseConversationId(uriApi.file('/local/conv-42').with({ scheme: 'openai-codex' })),
    ).toBeNull();
    expect(
      parseConversationId(
        uriApi.file('/extension/panel/new').with({ scheme: 'openai-codex', authority: 'route' }),
      ),
    ).toBeNull();
    expect(parseConversationId(null)).toBeNull();
    expect(parseConversationId(undefined)).toBeNull();
  });

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
});
