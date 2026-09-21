import { describe, expect, it } from 'vitest';
import {
  buildConversationUri,
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
});
