import type { ThreadItemRecord } from '../codex/types';
import { stripMentionTargets } from './sessionStore';

export interface SessionPreview {
  userMessages: string[];
  lastReply: string | null;
}

const MAX_PREVIEW_CHARS = 1200;

function truncate(text: string): string {
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS - 3)}…` : text;
}

/** Codex 的消息文本里会混入 `&#x20;` 之类的 HTML 实体，展示前统一还原。 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function cleanPreviewText(text: string): string {
  return stripMentionTargets(decodeHtmlEntities(text))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 从 `userMessage` item 里取纯文本；系统注入的 AGENTS/environment 不算用户输入。 */
export function userMessageText(record: ThreadItemRecord): string | null {
  const item = record.item;
  if (item?.type !== 'userMessage') return null;
  const raw = (item.content ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text!.trim())
    .filter((part) => part.length > 0)
    .join('\n')
    .trim();
  const text = cleanPreviewText(raw);
  if (!text) return null;
  if (
    text.startsWith('<environment_context>') ||
    text.startsWith('<user_instructions>') ||
    /^# AGENTS\.md instructions/i.test(text)
  ) {
    return null;
  }
  return text;
}

export function agentMessageText(record: ThreadItemRecord): string | null {
  const item = record.item;
  if (item?.type !== 'agentMessage') return null;
  const text = typeof item.text === 'string' ? cleanPreviewText(item.text) : '';
  return text.length > 0 ? text : null;
}

/**
 * `firstItems` 是从开头按升序拿到的 item；`tailItems` 是从结尾按降序拿到的 item。
 *
 * 用户消息取前两条 + 最后一条（重复则去重）；模型回复优先取 `final_answer`，
 * 找不到最终答复时退回最后一条助手消息。
 */
export function buildSessionPreview(
  firstItems: ReadonlyArray<ThreadItemRecord>,
  tailItems: ReadonlyArray<ThreadItemRecord>,
): SessionPreview {
  const first: string[] = [];
  for (const item of firstItems) {
    if (first.length >= 2) break;
    const text = userMessageText(item);
    if (text) first.push(text);
  }

  let lastUser: string | null = null;
  let finalReply: string | null = null;
  let anyReply: string | null = null;
  for (const item of tailItems) {
    if (!lastUser) {
      const text = userMessageText(item);
      if (text) lastUser = text;
    }
    const reply = agentMessageText(item);
    if (reply) {
      anyReply ??= reply;
      if (!finalReply && item.item?.phase === 'final_answer') finalReply = reply;
    }
  }

  const messages = [...first];
  if (lastUser && !messages.includes(lastUser)) messages.push(lastUser);
  return {
    userMessages: messages.map(truncate),
    lastReply: finalReply || anyReply ? truncate(finalReply ?? anyReply!) : null,
  };
}
