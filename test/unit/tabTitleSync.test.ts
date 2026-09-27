import { describe, expect, it } from 'vitest';
import { CODEX_DEFAULT_TAB_TITLE, resourceKey } from '../../src/session/tabTitleSync';
import { createFakeUriApi } from '../helpers/fakes';

const uriApi = createFakeUriApi();

describe('tabTitleSync', () => {
  it('codex_default_tab_title_matches_upstream_constant', () => {
    // 上游 bundle 里这个常量是 `qke = "Codex"`：我们靠它认出「标题还没被 Codex 写过」的标签
    expect(CODEX_DEFAULT_TAB_TITLE).toBe('Codex');
  });

  // REQ: 会话打开与聚焦 / Scenario: 同一个标签的 resource 身份
  it('resource_key_covers_scheme_authority_path_query', () => {
    const base = uriApi
      .file('/local/t1')
      .with({ scheme: 'openai-codex', authority: 'route', query: '' });

    expect(resourceKey(base)).toBe('openai-codex://route/local/t1?');
    // query 也是身份的一部分：Codex 用带 query 的 resource 区分远端/项目会话，
    // 少读一段就会把两个不同的标签认成同一个
    expect(resourceKey({ ...base, query: 'projectId=p1' })).toBe(
      'openai-codex://route/local/t1?projectId=p1',
    );
    expect(resourceKey({ ...base, authority: 'other' })).not.toBe(resourceKey(base));
    expect(resourceKey({ ...base, path: '/local/t2' })).not.toBe(resourceKey(base));
    expect(resourceKey({ ...base, scheme: 'file' })).not.toBe(resourceKey(base));
  });
});
