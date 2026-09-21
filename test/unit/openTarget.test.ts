import { describe, expect, it } from 'vitest';
import type { UriLike } from '../../src/codex/types';
import { readSessionRow, resolveOpenTarget } from '../../src/session/openTarget';
import { createFakeUriApi } from '../helpers/fakes';

const uriApi = createFakeUriApi();
const codexUri = (path: string, query = ''): UriLike =>
  uriApi.file(path).with({ scheme: 'openai-codex', authority: 'route', query }) as UriLike;

describe('openTarget', () => {
  // REQ: 会话打开与聚焦 / Scenario: 已打开的会话按它自己的标签 resource 打开
  it('open_session_row_resolves_to_its_tab_resource', () => {
    const tabUri = codexUri('/local/conv-1', 'projectId=p1');

    const target = resolveOpenTarget(readSessionRow({ sessionId: 'conv-1', tabUri }));

    expect(target).toEqual({ kind: 'tab', uri: tabUri });
    // query 必须原样保留：由 id 重拼出来的 resource 会丢掉它
    expect(target && target.kind === 'tab' ? target.uri.query : null).toBe('projectId=p1');
  });

  // REQ: 会话打开与聚焦 / Scenario: 远端标签对应的会话按它自己的远端 resource 打开
  it('keeps_remote_row_on_its_own_resource', () => {
    const tabUri = codexUri('/remote/conv-r');

    const target = resolveOpenTarget(readSessionRow({ sessionId: 'conv-r', tabUri }));

    expect(target?.kind).toBe('tab');
    expect(target && target.kind === 'tab' ? target.uri.path : null).toBe('/remote/conv-r');
  });

  // REQ: 会话打开与聚焦 / Scenario: 没有标签 resource 的条目仍按会话 id 打开
  it('falls_back_to_conversation_id_without_usable_tab_resource', () => {
    // 没开着标签 / 开着但 resource 为空 / resource 形状不合法 → 都退回按会话 id 打开
    for (const node of [
      { sessionId: 'conv-9' },
      { sessionId: 'conv-9', tabUri: null },
      { sessionId: 'conv-9', tabUri: { scheme: 'openai-codex' } },
    ]) {
      expect(resolveOpenTarget(readSessionRow(node))).toEqual({ kind: 'conversation', id: 'conv-9' });
    }

    // 右键菜单传进来的节点是嵌在 session 里的形状
    expect(resolveOpenTarget(readSessionRow({ session: { id: 'conv-2' } }))).toEqual({
      kind: 'conversation',
      id: 'conv-2',
    });
    // 既没有 id 也没有 resource → 不动作
    expect(resolveOpenTarget(readSessionRow({}))).toBeNull();
    expect(resolveOpenTarget(readSessionRow(undefined))).toBeNull();
  });

  // INV-001: 任意一行都指向它自己的来源对象（不重拼、不臆造）
  it('every_row_opens_its_own_source', () => {
    const panelUri = codexUri('/extension/panel/new', 'newPanel=n1');
    const localPlainUri = codexUri('/local/conv-1');
    const localQueryUri = codexUri('/local/conv-1', 'projectId=p1');
    const remoteUri = codexUri('/remote/conv-r');
    const cases: Array<{ label: string; node: unknown; tabUri: UriLike | null; id: string | null }> = [
      {
        label: '未绑定面板（合成 id + 面板 resource）',
        node: { sessionId: 'open-tab:0', tabUri: panelUri },
        tabUri: panelUri,
        id: 'open-tab:0',
      },
      {
        label: '本地会话（无 query）',
        node: { sessionId: 'conv-1', tabUri: localPlainUri },
        tabUri: localPlainUri,
        id: 'conv-1',
      },
      {
        label: '本地会话（带 query）',
        node: { sessionId: 'conv-1', tabUri: localQueryUri },
        tabUri: localQueryUri,
        id: 'conv-1',
      },
      {
        label: '远端会话',
        node: { sessionId: 'conv-r', tabUri: remoteUri },
        tabUri: remoteUri,
        id: 'conv-r',
      },
      { label: '没开着标签', node: { sessionId: 'conv-9' }, tabUri: null, id: 'conv-9' },
      { label: '右键菜单形状', node: { session: { id: 'conv-3' } }, tabUri: null, id: 'conv-3' },
    ];

    let checked = 0;
    let tabTargets = 0;
    let conversationTargets = 0;
    for (const entry of cases) {
      const row = readSessionRow(entry.node);
      const target = resolveOpenTarget(row);

      if (entry.tabUri !== null) {
        // 有标签 resource ⇒ 目标就是它本身（原样，不重拼）
        expect(target, `${entry.label} 目标`).toEqual({ kind: 'tab', uri: entry.tabUri });
        expect(row.id, `${entry.label} id 仍被读出`).toBe(entry.id);
        tabTargets += 1;
      } else {
        expect(target, `${entry.label} 目标`).toEqual({ kind: 'conversation', id: entry.id });
        conversationTargets += 1;
      }
      checked += 1;
    }

    // 反空转护栏：两类目标都必须真的出现过
    expect(checked).toBe(cases.length);
    expect(tabTargets).toBeGreaterThan(0);
    expect(conversationTargets).toBeGreaterThan(0);
  });
});
