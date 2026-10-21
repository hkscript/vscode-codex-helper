import * as vscode from 'vscode';
import { CODEX_CONVERSATION_VIEW_TYPE } from '../codex/conversationUri';
import type { OpenTab, UriLike } from '../codex/types';
import type { Logger } from '../log';
import { scanCodexTabs, selectTabsForConversation } from '../session/openTabs';
import { CODEX_DEFAULT_TAB_TITLE, resourceKey } from '../session/tabTitleSync';

export interface EditorTabs {
  /** 此刻开着的 Codex 会话标签。 */
  openTabs(): OpenTab[];
  /** 删除会话后要关掉的标签（只关会话 id 完全匹配的那些），交给 tabGroups.close。 */
  tabsOfConversation(conversationId: string): unknown[];
  /**
   * 点击某一行时：如果那个标签的标题还停在 Codex 默认值，就关掉重开一次。
   *
   * 为什么只能关掉重开：Codex 只在 `resolveCustomEditor` 那一刻写标题，而 VS Code 没有
   * 原地重解析的办法——Codex 的自定义编辑器 `supportsMultipleEditorsPerDocument: false`
   * 对应内部的 `singlePerResource`，用同一个 resource 再 resolve 一次只会拿回**已经开着**
   * 的那个编辑器，等于什么都不做。所以「让标题变对」= 让那个标签重新出生一次。
   *
   * 之所以挂在点击上而不是后台自动跑：重开会重载面板（内容白一下、未发送的草稿会丢），
   * 只有用户主动点这一行时才值得付这个代价。
   *
   * 返回 `true` = 已经重载好了（重开后它就是激活标签，调用方不用再聚焦）；`false` =
   * 没什么可重载的、或者重载没做成 —— 两种情况调用方都会退到 `revealTab`，所以失败
   * 不会让这一行打不开。
   */
  reloadUntitledTab(uri: UriLike): Promise<boolean>;
}

const tabScanOptions = {
  isCustomInput: (input: unknown) => input instanceof vscode.TabInputCustom,
};

/** 当前激活标签的 resource 身份；`putTabBack` 用它确认「当前激活的就是刚打开那个」。 */
function activeTabResourceKey(): string | null {
  const input = vscode.window.tabGroups.activeTabGroup?.activeTab?.input as
    | { uri?: UriLike }
    | undefined;
  const uri = input && typeof input === 'object' ? input.uri : undefined;
  return uri && typeof uri.path === 'string' ? resourceKey(uri) : null;
}

/**
 * 把刚重开的标签放回组内的原来那一格。
 *
 * 公开 API 没有移动/排序标签的能力，只能用 VS Code 的内部命令 `moveActiveEditor`
 * （「Move Editor Left/Right」「Move Editor to Start/End」这些内置动作执行的就是它）。
 * 语义取自本机 1.96 的产物 `workbench.desktop.main.js`：`{to:'position', by:'tab', value}`
 * 的 value 是 **1 基**下标，越界会被夹到末尾。拿不到原始下标、或命令不存在时都不动作
 * ——最坏情况只是标签留在末尾。
 */
async function putTabBack(tab: { uri: UriLike; index?: number }): Promise<void> {
  const index = tab.index;
  if (typeof index !== 'number' || index < 0) return;
  // moveActiveEditor 作用于**当前激活编辑器**：如果重开没有把它激活（某些版本上
  // preserveFocus 生效，或者用户手快切走了），这里动手就会挪错标签，所以先核对身份
  const activeKey = activeTabResourceKey();
  if (activeKey === null || activeKey !== resourceKey(tab.uri)) return;
  try {
    await vscode.commands.executeCommand('moveActiveEditor', {
      to: 'position',
      by: 'tab',
      value: index + 1,
    });
  } catch {
    // 内部命令不在（换编辑器/换版本）就只是位置不还原，别的都不受影响
  }
}

export function createEditorTabs(deps: { logger: Logger }): EditorTabs {
  function openTabs(): OpenTab[] {
    return scanCodexTabs(
      {
        all: vscode.window.tabGroups.all.map((group) => ({
          // 栏号与组内下标：重开之后要把标签原样放回去
          viewColumn: group.viewColumn,
          // 句柄一起带出去：重开一个标题过时的标签得先把它关掉，而关它只能靠它自己的句柄
          tabs: group.tabs.map((tab) => ({ label: tab.label, input: tab.input, handle: tab })),
        })),
      },
      tabScanOptions,
    );
  }

  function tabsOfConversation(conversationId: string): unknown[] {
    return selectTabsForConversation(
      {
        all: vscode.window.tabGroups.all.map((group) => ({
          tabs: group.tabs.map((tab) => ({ label: tab.label, input: tab.input, handle: tab })),
        })),
      },
      conversationId,
      tabScanOptions,
    );
  }

  async function reloadUntitledTab(uri: UriLike): Promise<boolean> {
    const key = resourceKey(uri);
    const tab = openTabs().find((candidate) => resourceKey(candidate.uri) === key);
    if (!tab || tab.tabLabel !== CODEX_DEFAULT_TAB_TITLE || tab.handle === undefined) return false;
    try {
      await vscode.window.tabGroups.close(tab.handle as never, true);
    } catch (error) {
      // 没关掉就别接着 openWith：那只会聚焦原来那个标签，白闪一下什么也没修好
      const reason = error instanceof Error ? error.message : String(error);
      deps.logger.warn(`重载会话标签前关闭失败：${reason}`);
      return false;
    }
    try {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        tab.uri,
        CODEX_CONVERSATION_VIEW_TYPE,
        {
          // 落回它原来那一栏：不给 viewColumn 时会开在当前激活的栏里，标签等于搬了家
          ...(typeof tab.viewColumn === 'number' ? { viewColumn: tab.viewColumn } : {}),
          preview: false,
        },
      );
      // 重开出来的标签落在末尾，把它挪回原来的那一格
      await putTabBack(tab);
      return true;
    } catch (error) {
      // 关掉了却没打开成功：返回 false 让调用方用 revealTab 兜底把它开回来
      const reason = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`重新加载会话标签失败：${reason}`);
      return false;
    }
  }

  return { openTabs, tabsOfConversation, reloadUntitledTab };
}
