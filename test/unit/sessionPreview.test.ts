import { describe, expect, it } from 'vitest';
import type { ThreadItemRecord } from '../../src/codex/types';
import { buildSessionPreview } from '../../src/session/sessionPreview';

function user(text: string): ThreadItemRecord {
  return { item: { type: 'userMessage', content: [{ type: 'text', text }] } };
}

function agent(text: string, phase?: string): ThreadItemRecord {
  return { item: { type: 'agentMessage', text, phase } };
}

describe('sessionPreview', () => {
  it('takes_the_first_two_and_last_user_input_plus_the_final_model_reply', () => {
    const preview = buildSessionPreview(
      [user('第一条'), agent('过程'), user('第二条'), user('第三条')],
      // tail 是按降序拿到的：最后一条用户输入在前，最终回复在后面一条
      [user('第三条'), agent('过程回复', 'commentary'), agent('最终回复', 'final_answer')],
    );

    expect(preview.userMessages).toEqual(['第一条', '第二条', '第三条']);
    expect(preview.lastReply).toBe('最终回复');
  });

  it('falls_back_to_the_last_agent_message_when_there_is_no_final_answer', () => {
    const preview = buildSessionPreview(
      [user('问题')],
      [user('问题'), agent('最后一条过程消息', 'commentary')],
    );

    expect(preview.userMessages).toEqual(['问题']);
    expect(preview.lastReply).toBe('最后一条过程消息');
  });

  it('ignores_injected_agents_and_environment_messages', () => {
    const preview = buildSessionPreview(
      [
        user('<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>'),
        user('# AGENTS.md instructions for /tmp\n\nrules'),
        user('真正的问题'),
      ],
      [user('真正的问题'), agent('回答', 'final_answer')],
    );

    expect(preview.userMessages).toEqual(['真正的问题']);
    expect(preview.lastReply).toBe('回答');
  });

  it('does_not_duplicate_the_last_user_input_when_there_are_only_two', () => {
    const preview = buildSessionPreview(
      [user('问题一'), user('问题二')],
      [user('问题二'), agent('回答', 'final_answer')],
    );

    expect(preview.userMessages).toEqual(['问题一', '问题二']);
    expect(preview.lastReply).toBe('回答');
  });

  it('decodes_html_entities_and_strips_mention_target_paths', () => {
    const preview = buildSessionPreview(
      [
        user(
          '做了迁移 参考技能 [$mc-ruban-etl-builder](/home/hk/meicai/dmp-task-engine/.codex/skills/mc-ruban-etl-builder/SKILL.md)&#x20;\n\n迁移结果&#x20;',
        ),
        user('是否需要分区&#x20;'),
      ],
      [user('是否需要分区&#x20;'), agent('已提交。&#x20;', 'final_answer')],
    );

    expect(preview.userMessages[0]).toBe(
      '做了迁移 参考技能 [$mc-ruban-etl-builder]\n\n迁移结果',
    );
    expect(preview.userMessages[1]).toBe('是否需要分区');
    expect(preview.lastReply).toBe('已提交。');
  });
});
