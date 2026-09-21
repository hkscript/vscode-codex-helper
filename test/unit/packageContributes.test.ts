import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface MenuContribution {
  command: string;
  when?: string;
  group?: string;
}

const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
) as {
  contributes: {
    commands: Array<{ command: string; icon?: string }>;
    menus: { 'view/item/context': MenuContribution[] };
  };
};

function entriesFor(command: string): MenuContribution[] {
  return manifest.contributes.menus['view/item/context'].filter((entry) => entry.command === command);
}

function isInline(entry: MenuContribution): boolean {
  return (entry.group ?? '').startsWith('inline');
}

describe('packageContributes', () => {
  // REQ: 会话归档与删除 / Scenario: 未归档条目提供归档按钮、已归档条目提供删除按钮
  it('archive_inline_on_sessions_delete_inline_on_archived', () => {
    const archive = entriesFor('codexHelper.archiveSession');
    const remove = entriesFor('codexHelper.deleteSession');
    const open = entriesFor('codexHelper.openSession');

    // 悬停按钮：归档只挂在未归档条目上
    expect(archive).toHaveLength(1);
    expect(isInline(archive[0]!)).toBe(true);
    expect(archive[0]!.when).toContain('viewItem =~ /^session/');
    expect(archive[0]!.when).toContain('viewItem != session.archived');

    // 删除只挂在已归档条目上 —— 「必须先归档」这道闸就是靠这条 when 实现的
    expect(remove).toHaveLength(1);
    expect(isInline(remove[0]!)).toBe(true);
    expect(remove[0]!.when).toContain('viewItem == session.archived');

    // 「打开会话」不再占悬停区（点击条目本身就能打开），但右键菜单里仍然有
    expect(open.length).toBeGreaterThan(0);
    expect(open.some(isInline)).toBe(false);

    // 取消归档必须有入口：归档可逆是「删除不弹确认」的前提
    const unarchive = entriesFor('codexHelper.unarchiveSession');
    expect(unarchive.length).toBeGreaterThan(0);
    expect(unarchive[0]!.when).toContain('viewItem == session.archived');

    // 悬停按钮的视觉锚点：图标名必须是真实存在的 codicon
    const commands = manifest.contributes.commands;
    expect(commands.find((entry) => entry.command === 'codexHelper.archiveSession')?.icon).toBe('$(archive)');
    expect(commands.find((entry) => entry.command === 'codexHelper.deleteSession')?.icon).toBe('$(trash)');
  });
});
