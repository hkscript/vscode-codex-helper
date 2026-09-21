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
    viewsContainers: { activitybar: Array<{ id: string; title: string }> };
    views: Record<string, Array<{ id: string; name: string; contextualTitle?: string }>>;
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

  // REQ: 侧边栏标题 / Scenario: 侧边栏标题不出现重复的「会话」
  it('sidebar_title_is_not_duplicated', () => {
    const container = manifest.contributes.viewsContainers.activitybar.find(
      (entry) => entry.id === 'codexHelper',
    );
    const view = manifest.contributes.views.codexHelper?.find(
      (entry) => entry.id === 'codexHelper.sessions',
    );
    expect(container).toBeDefined();
    expect(view).toBeDefined();

    // VS Code 把容器标题与视图名渲染成 `<容器标题>: <视图名>`；两段都写「会话」时
    // 标题栏会变成 `CODEX 会话: 会话`（用户实测截图），所以两段必须各司其职。
    expect(container!.title).toBe('Codex');
    expect(view!.name).toBe('会话');
    // contextualTitle 会参与同一段渲染，本视图不需要它
    expect(view!.contextualTitle).toBeUndefined();

    const rendered = `${container!.title}: ${view!.name}`;
    expect(rendered).toBe('Codex: 会话');
    expect(rendered.match(/会话/g) ?? []).toHaveLength(1);
  });
});
