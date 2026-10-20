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
  extensionDependencies?: string[];
  contributes: {
    commands: Array<{ command: string; icon?: string }>;
    menus: { 'view/title': MenuContribution[] };
    viewsContainers: { activitybar: Array<{ id: string; title: string }> };
    views: Record<
      string,
      Array<{
        id: string;
        name: string;
        contextualTitle?: string;
        when?: string;
        type?: string;
      }>
    >;
  };
};

describe('packageContributes', () => {
  // VS Code 默认把扩展视图当成 TreeView；不写 type: webview 时，
  // 即使调用了 registerWebviewViewProvider，视图也永远不会 resolve（实测）。
  it('declares_the_session_view_as_a_webview', () => {
    const view = manifest.contributes.views.codexHelper?.find(
      (entry) => entry.id === 'codexHelper.sessions',
    );
    expect(view?.type).toBe('webview');
    // 不再需要靠 when 门控或抢先在启动阶段激活
    expect(view?.when).toBeUndefined();
  });

  it('keeps_the_official_codex_extension_as_a_dependency', () => {
    expect(manifest.extensionDependencies).toContain('openai.chatgpt');
  });

  // 侧边栏换成 Webview 后，行内菜单由 webview 自己画；标题栏只保留全局动作，
  // 搜索框和目录筛选也在 webview 里，不该再重复占一个标题栏图标。
  it('title_bar_only_keeps_global_actions', () => {
    const titles = manifest.contributes.menus['view/title'];
    const commands = titles.map((entry) => entry.command);

    expect(commands).toContain('codexHelper.newSession');
    expect(commands).toContain('codexHelper.refresh');
    expect(commands).not.toContain('codexHelper.setFilter');
    expect(commands).not.toContain('codexHelper.clearFilter');

    // 命令本身仍然保留：命令面板和 webview 消息都会用到
    const declared = manifest.contributes.commands.map((entry) => entry.command);
    for (const command of [
      'codexHelper.openSession',
      'codexHelper.renameSession',
      'codexHelper.pinSession',
      'codexHelper.archiveSession',
      'codexHelper.unarchiveSession',
      'codexHelper.deleteSession',
    ]) {
      expect(declared).toContain(command);
    }
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
