/**
 * Self-contained markup for the session sidebar webview.
 *
 * The extension side is deliberately dumb about the DOM: this file owns the
 * layout (search row, directory filter, grouped list, context menu) and only
 * exchanges plain messages with the provider. Everything is inline because a
 * webview view has no reliable local resource root for a sidebar that can be
 * opened in any workspace.
 */

export interface SessionWebviewHtmlOptions {
  nonce: string;
  cspSource: string;
}

export function sessionWebviewHtml({ nonce, cspSource }: SessionWebviewHtmlOptions): string {
  return String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    display: flex;
    flex-direction: column;
    margin: 0;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, transparent);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    overflow: hidden;
    user-select: none;
  }
  button {
    margin: 0;
    border: 0;
    padding: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .hidden { display: none !important; }
  .top { padding: 8px 10px 2px; }
  .new-session {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 6px 7px;
    border-radius: 4px;
    text-align: left;
  }
  .new-session:hover { background: var(--vscode-list-hoverBackground); }
  .search-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 10px 6px;
    padding: 0 6px;
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    background: var(--vscode-input-background);
  }
  .search-row:focus-within { border-color: var(--vscode-focusBorder); }
  .search-row input {
    flex: 1;
    min-width: 0;
    padding: 5px 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--vscode-input-foreground);
    font: inherit;
  }
  .search-row input::placeholder { color: var(--vscode-input-placeholderForeground); }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 1px 8px 7px;
    color: var(--vscode-descriptionForeground);
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 5px;
  }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .icon-btn.active { color: var(--vscode-focusBorder); }
  .toolbar svg { width: 16px; height: 16px; }
  .filter-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 28px;
    padding: 0 7px;
    border-radius: 5px;
    background: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, .12));
  }
  .filter-btn:hover { background: var(--vscode-toolbar-activeBackground, rgba(127, 127, 127, .2)); }
  .filter-btn.active { color: var(--vscode-focusBorder); }
  .filter-caret { margin-top: 1px; font-size: 9px; opacity: .85; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: 0 1 auto;
    width: fit-content;
    max-width: calc(100% - 44px);
    min-width: 0;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    font-size: 11px;
  }
  .chip-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip button { display: inline-flex; opacity: .8; }
  .chip button:hover { opacity: 1; }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 10px;
    scrollbar-width: thin;
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 10px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    font-weight: 600;
    text-align: left;
  }
  .group-head:hover { background: var(--vscode-list-hoverBackground); }
  .chevron { width: 13px; flex: none; text-align: center; font-size: 11px; }
  .group-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count {
    flex: none;
    min-width: 18px;
    height: 18px;
    margin-left: auto;
    padding: 0 6px;
    border-radius: 9px;
    background: var(--vscode-activityBarBadge-background, #0e639c);
    color: var(--vscode-activityBarBadge-foreground, #fff);
    font-size: 11px;
    font-weight: 500;
    line-height: 18px;
    text-align: center;
  }
  .group-body { padding-bottom: 4px; }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 4px 8px 4px 14px;
    border-left: 2px solid transparent;
    outline: none;
    cursor: pointer;
  }
  .row:hover, .row:focus { background: var(--vscode-list-hoverBackground); }
  .row:focus { border-left-color: var(--vscode-focusBorder); }
  .row-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pin { margin-right: 2px; font-size: 11px; }
  .row-time { flex: none; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .row-more {
    flex: none;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    opacity: 0;
    color: var(--vscode-descriptionForeground);
    line-height: 18px;
    text-align: center;
  }
  .row:hover .row-more, .row:focus .row-more, .row-more:focus { opacity: 1; }
  .row-more:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); }
  .status { padding: 14px 10px; color: var(--vscode-descriptionForeground); text-align: center; font-size: 12px; }
  .error {
    margin: 6px 10px 8px;
    padding: 8px;
    border: 1px solid var(--vscode-inputValidation-errorBorder, #f14c4c);
    border-radius: 4px;
    color: var(--vscode-errorForeground, #f14c4c);
    font-size: 12px;
    user-select: text;
  }
  .error button {
    margin-top: 6px;
    padding: 3px 8px;
    border-radius: 3px;
    background: var(--vscode-button-secondaryBackground, rgba(127, 127, 127, .2));
    color: var(--vscode-button-secondaryForeground, inherit);
  }
  .error button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(127, 127, 127, .3)); }
  .menu {
    position: fixed;
    z-index: 30;
    min-width: 170px;
    max-height: 60vh;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
    border-radius: 4px;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    box-shadow: 0 2px 8px rgba(0, 0, 0, .35);
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border-radius: 3px;
    text-align: left;
  }
  .menu-item:hover, .menu-item.active {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
    color: var(--vscode-menu-selectionForeground, inherit);
  }
  .menu-item .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu-item .check {
    flex: none;
    width: 12px;
    color: var(--vscode-focusBorder);
    font-size: 11px;
    text-align: center;
  }
  .menu-item .sub {
    margin-left: auto;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }
  .menu-sep { height: 1px; margin: 4px 6px; background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border)); }
  .load-more {
    display: block;
    width: calc(100% - 20px);
    margin: 4px 10px;
    padding: 5px;
    border-radius: 3px;
    color: var(--vscode-textLink-foreground);
    text-align: center;
    font-size: 12px;
  }
  .load-more:hover { background: var(--vscode-list-hoverBackground); }
  .tooltip {
    position: fixed;
    z-index: 50;
    width: max-content;
    max-width: calc(100vw - 8px);
    max-height: 60vh;
    overflow: hidden;
    padding: 8px 10px;
    border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border, transparent));
    border-radius: 4px;
    background: var(--vscode-editorHoverWidget-background, var(--vscode-menu-background));
    color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
    box-shadow: 0 2px 10px rgba(0, 0, 0, .35);
    pointer-events: none;
    font-size: 12px;
    line-height: 1.45;
    user-select: none;
  }
  .tooltip-section {
    display: block;
  }
  .tooltip-section + .tooltip-section { margin-top: 8px; }
  .tooltip-label {
    display: inline-block;
    margin-bottom: 2px;
    padding: 0 7px;
    border-radius: 9px;
    background: var(--vscode-activityBarBadge-background, #0e639c);
    color: var(--vscode-activityBarBadge-foreground, #fff);
    font-size: 11px;
    font-weight: 700;
    line-height: 18px;
    white-space: nowrap;
  }
  .tooltip-text {
    display: -webkit-box;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;
  }
  .tooltip-empty { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div class="top">
    <button id="new-session" class="new-session" title="新建会话">
      <span id="new-session-icon"></span>
      <span>New session</span>
    </button>
  </div>

  <div class="search-row">
    <span id="search-icon"></span>
    <input id="search" type="text" placeholder="Search sessions..." autocomplete="off" spellcheck="false" aria-label="搜索会话" />
    <button id="clear-search" class="icon-btn hidden" title="清除搜索" aria-label="清除搜索"></button>
  </div>

  <div class="toolbar">
    <button id="cwd-filter" class="filter-btn" title="按工作目录过滤" aria-label="按工作目录过滤">
      <span id="cwd-filter-icon"></span>
      <span class="filter-caret" aria-hidden="true">▾</span>
    </button>
    <span id="cwd-chip" class="chip hidden">
      <span>过滤</span>
      <span id="cwd-chip-label" class="chip-label"></span>
      <button id="cwd-chip-clear" title="清除目录过滤" aria-label="清除目录过滤"></button>
    </span>
  </div>

  <div id="list" class="list" role="tree"></div>
  <div id="cwd-menu" class="menu hidden" role="menu"></div>
  <div id="ctx-menu" class="menu hidden" role="menu"></div>
  <div id="session-tooltip" class="tooltip hidden" role="tooltip"></div>

  <script nonce="${nonce}">
    (function () {
      var vscode = acquireVsCodeApi();
      var el = function (id) { return document.getElementById(id); };
      var data = null;
      var expanded = {};
      var ctxSession = null;
      var hoverTimer = null;
      var hoverRow = null;
      var hoverRequestId = 0;

      var SVG_NS = 'http://www.w3.org/2000/svg';
      function svg(path) {
        var node = document.createElementNS(SVG_NS, 'svg');
        node.setAttribute('viewBox', '0 0 16 16');
        node.setAttribute('width', '14');
        node.setAttribute('height', '14');
        node.setAttribute('fill', 'none');
        node.setAttribute('stroke', 'currentColor');
        node.setAttribute('stroke-width', '1.25');
        node.setAttribute('stroke-linecap', 'round');
        node.setAttribute('stroke-linejoin', 'round');
        var shape = document.createElementNS(SVG_NS, 'path');
        shape.setAttribute('d', path);
        node.appendChild(shape);
        return node;
      }
      var ICONS = {
        plus: 'M8 2.5v11M2.5 8h11',
        search: 'M7 12.2a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4Zm3.8-1.4 3 3',
        filter: 'M2.5 3.5h11L9 8.7v3.4l-2 .9V8.7L2.5 3.5Z',
        close: 'M3.5 3.5l9 9m0-9-9 9'
      };

      function post(message) { vscode.postMessage(message); }
      function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
      function basename(path) {
        var parts = String(path || '').split(/[\\/]+/).filter(function (part) { return part.length > 0; });
        return parts.length ? parts[parts.length - 1] : path;
      }
      function appendIcon(host, name) { host.appendChild(svg(ICONS[name])); }

      function render(payload) {
        data = payload;
        expanded = payload.expanded || {};
        hidePreview();
        if (document.activeElement !== el('search')) el('search').value = payload.filter || '';
        el('clear-search').classList.toggle('hidden', !(payload.filter || '').length);
        el('cwd-filter').classList.toggle('active', (payload.cwdFilter || []).length > 0);
        renderCwdChip(payload);
        renderList(payload);
        // 多选目录时菜单要保持打开；重绘后按新状态重建它
        el('ctx-menu').classList.add('hidden');
        ctxSession = null;
        if (!el('cwd-menu').classList.contains('hidden')) showCwdMenu();
      }

      function renderCwdChip(payload) {
        var chip = el('cwd-chip');
        var selected = payload.cwdFilter || [];
        if (selected.length === 0) {
          chip.classList.add('hidden');
          return;
        }
        el('cwd-chip-label').textContent = selected.length === 1
          ? basename(selected[0])
          : selected.length + ' 个目录';
        el('cwd-chip-label').title = selected.join('\n');
        chip.classList.remove('hidden');
      }

      function renderList(payload) {
        var list = el('list');
        var scrollTop = list.scrollTop;
        clear(list);

        if (payload.error) {
          list.appendChild(errorBox(payload.error));
          if (!payload.groups || payload.groups.length === 0) return;
        }
        if (payload.loading && (!payload.groups || payload.groups.length === 0)) {
          list.appendChild(status('加载中…'));
          return;
        }
        var filtering = (payload.filter || '').trim().length > 0 || (payload.cwdFilter || []).length > 0;
        if (!payload.groups || payload.groups.length === 0) {
          list.appendChild(
            status(
              filtering
                ? payload.loadingAll
                  ? '正在加载全部会话…'
                  : '没有匹配的会话'
                : '还没有会话'
            )
          );
          if (!filtering) {
            if (payload.hasMore) list.appendChild(loadMoreButton(false, '加载更多'));
            if (payload.archivedHasMore) list.appendChild(loadMoreButton(true, '加载更多已归档'));
          }
          syncLoadMoreVisibility(payload);
          return;
        }

        // 「置顶」「最近」都不显示组头，会话直接作为一级条目（置顶在前）；
        // 历史/已归档仍保留分组。
        // 未归档分页的「加载更多」落在历史之后、已归档之前。
        var pinned = payload.groups.filter(function (group) { return group.id === 'pinned'; });
        var recent = payload.groups.find(function (group) { return group.id === 'recent'; });
        var history = payload.groups.filter(function (group) { return group.id === 'history'; });
        var archived = payload.groups.filter(function (group) { return group.id === 'archived'; });
        for (var i = 0; i < pinned.length; i += 1) {
          for (var p = 0; p < pinned[i].sessions.length; p += 1) {
            list.appendChild(sessionRow(pinned[i].sessions[p]));
          }
        }
        if (recent) {
          for (var r = 0; r < recent.sessions.length; r += 1) {
            list.appendChild(sessionRow(recent.sessions[r]));
          }
        }
        for (var h = 0; h < history.length; h += 1) {
          list.appendChild(groupNode(history[h]));
        }
        if (!filtering && payload.hasMore) list.appendChild(loadMoreButton(false, '加载更多'));
        for (var j = 0; j < archived.length; j += 1) {
          list.appendChild(groupNode(archived[j]));
        }
        if (!filtering && payload.archivedHasMore) {
          list.appendChild(loadMoreButton(true, '加载更多已归档'));
        }
        if (filtering && payload.loadingAll) list.appendChild(status('正在加载全部会话…'));
        syncLoadMoreVisibility(payload);
        list.scrollTop = scrollTop;
      }

      function loadMoreButton(archived, label) {
        var more = document.createElement('button');
        more.className = 'load-more';
        more.dataset.kind = archived ? 'archived' : 'unarchived';
        more.textContent = label;
        more.onclick = function () {
          post({ type: 'loadMore', archived: archived });
        };
        return more;
      }

      function syncLoadMoreVisibility(payload) {
        var unarchivedMore = document.querySelector('.load-more[data-kind="unarchived"]');
        if (unarchivedMore) {
          var hasHistory = (payload.groups || []).some(function (group) {
            return group.id === 'history';
          });
          unarchivedMore.classList.toggle('hidden', hasHistory && expanded.history === false);
        }
        var archivedMore = document.querySelector('.load-more[data-kind="archived"]');
        if (archivedMore) {
          var hasArchived = (payload.groups || []).some(function (group) {
            return group.id === 'archived';
          });
          archivedMore.classList.toggle('hidden', hasArchived && expanded.archived === false);
        }
      }

      function status(text) {
        var node = document.createElement('div');
        node.className = 'status';
        node.textContent = text;
        return node;
      }

      function errorBox(message) {
        var box = document.createElement('div');
        box.className = 'error';
        var text = document.createElement('div');
        text.textContent = '加载失败：' + message;
        var retry = document.createElement('button');
        retry.textContent = '重试';
        retry.onclick = function () { post({ type: 'retry' }); };
        box.appendChild(text);
        box.appendChild(retry);
        return box;
      }

      function groupNode(group) {
        var section = document.createElement('section');
        section.setAttribute('role', 'group');
        var open = expanded[group.id] !== false;

        var head = document.createElement('button');
        head.className = 'group-head';
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        var chevron = document.createElement('span');
        chevron.className = 'chevron';
        chevron.textContent = open ? '▾' : '▸';
        var label = document.createElement('span');
        label.className = 'group-label';
        label.textContent = group.label;
        var count = document.createElement('span');
        count.className = 'count';
        count.textContent = String(group.sessions.length);
        head.appendChild(chevron);
        head.appendChild(label);
        head.appendChild(count);

        var body = document.createElement('div');
        body.className = 'group-body';
        if (open) {
          for (var i = 0; i < group.sessions.length; i += 1) {
            body.appendChild(sessionRow(group.sessions[i]));
          }
        }

        head.onclick = function () {
          var next = expanded[group.id] === false;
          expanded[group.id] = next;
          chevron.textContent = next ? '▾' : '▸';
          head.setAttribute('aria-expanded', next ? 'true' : 'false');
          clear(body);
          if (next) {
            for (var j = 0; j < group.sessions.length; j += 1) {
              body.appendChild(sessionRow(group.sessions[j]));
            }
          }
          if (data) syncLoadMoreVisibility(data);
          post({ type: 'toggleGroup', id: group.id, expanded: next });
        };

        section.appendChild(head);
        section.appendChild(body);
        return section;
      }

      function sessionRow(session) {
        var row = document.createElement('div');
        row.className = 'row';
        row.tabIndex = 0;
        row.setAttribute('role', 'treeitem');
        row.setAttribute('aria-label', session.label || session.id);
        row.dataset.sessionId = session.id;

        var title = document.createElement('span');
        title.className = 'row-title';
        if (session.pinned) {
          var pin = document.createElement('span');
          pin.className = 'pin';
          pin.textContent = '📌';
          title.appendChild(pin);
        }
        title.appendChild(document.createTextNode(session.label || session.id));

        var time = document.createElement('span');
        time.className = 'row-time';
        time.dataset.sessionId = session.id;
        time.textContent = session.time || '';

        var more = document.createElement('button');
        more.className = 'row-more';
        more.title = '更多操作';
        more.setAttribute('aria-label', '更多操作');
        more.textContent = '⋯';
        more.onclick = function (event) {
          event.stopPropagation();
          showContextMenu(session, more);
        };

        row.appendChild(title);
        row.appendChild(time);
        row.appendChild(more);
        row.onclick = function () { openSession(session); };
        row.onmouseenter = function () { schedulePreview(session, row); };
        row.onmouseleave = function () { hidePreview(); };
        row.onfocus = function () { schedulePreview(session, row); };
        row.onblur = function () { hidePreview(); };
        row.oncontextmenu = function (event) {
          event.preventDefault();
          showContextMenu(session, event);
        };
        row.onkeydown = function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openSession(session);
          } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            showContextMenu(session, row);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveFocus(row, event.key === 'ArrowDown' ? 1 : -1);
          }
        };
        return row;
      }

      function moveFocus(row, delta) {
        var rows = Array.prototype.slice.call(document.querySelectorAll('.row'));
        var index = rows.indexOf(row);
        var next = rows[index + delta];
        if (next) next.focus();
      }

      function schedulePreview(session, row) {
        // 右键菜单打开期间不要弹悬停摘要，避免两个浮层叠在一起
        if (!el('ctx-menu').classList.contains('hidden')) return;
        if (hoverTimer) clearTimeout(hoverTimer);
        el('session-tooltip').classList.add('hidden');
        hoverRow = row;
        var requestId = ++hoverRequestId;
        hoverTimer = setTimeout(function () {
          hoverTimer = null;
          if (hoverRow !== row) return;
          post({
            type: 'preview',
            sessionId: session.id,
            updatedAt: session.updatedAt,
            requestId: requestId
          });
        }, 250);
      }

      function hidePreview() {
        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = null;
        hoverRow = null;
        hoverRequestId += 1;
        el('session-tooltip').classList.add('hidden');
      }

      function showPreview(messages, reply) {
        if (!hoverRow) return;
        var tip = el('session-tooltip');
        clear(tip);
        var list = messages || [];
        if (list.length === 0 && !reply) {
          var empty = document.createElement('div');
          empty.className = 'tooltip-empty';
          empty.textContent = '没有找到可显示的会话内容';
          tip.appendChild(empty);
        } else {
          var labels = list.length === 1
            ? ['首次输入']
            : list.length === 2
              ? ['首次输入', '最后输入']
              : ['首次输入', '二次输入', '最后输入'];
          for (var i = 0; i < list.length; i += 1) {
            appendPreviewSection(tip, labels[i] || '用户输入', list[i]);
          }
          if (reply) {
            appendPreviewSection(tip, '模型回复', reply);
          }
        }
        tip.classList.remove('hidden');
        var rect = hoverRow.getBoundingClientRect();
        tip.style.left = '0px';
        tip.style.top = '0px';
        var width = tip.offsetWidth;
        var height = tip.offsetHeight;
        var left = Math.max(4, Math.min(rect.left + 22, window.innerWidth - width - 6));
        var top = rect.bottom + 4;
        if (top + height > window.innerHeight - 4) top = Math.max(4, rect.top - height - 4);
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
      }

      function appendPreviewSection(tip, label, value) {
        var section = document.createElement('div');
        section.className = 'tooltip-section';
        var tag = document.createElement('span');
        tag.className = 'tooltip-label';
        tag.textContent = label;
        var text = document.createElement('span');
        text.className = 'tooltip-text';
        var content = String(value || '');
        text.textContent = content.length > 800 ? content.slice(0, 797) + '…' : content;
        section.appendChild(tag);
        section.appendChild(text);
        tip.appendChild(section);
      }

      function openSession(session) {
        post({
          type: 'open',
          session: {
            sessionId: session.id,
            label: session.label,
            archived: !!session.archived
          }
        });
      }

      function menuItem(menu, label, handler) {
        var item = document.createElement('button');
        item.className = 'menu-item';
        item.setAttribute('role', 'menuitem');
        var text = document.createElement('span');
        text.className = 'label';
        text.textContent = label;
        item.appendChild(text);
        item.onclick = function (event) {
          event.stopPropagation();
          hideMenus();
          handler();
        };
        menu.appendChild(item);
        return item;
      }

      function action(name, session) {
        post({
          type: 'action',
          action: name,
          session: { sessionId: session.id, label: session.label }
        });
      }

      function showContextMenu(session, anchor) {
        hidePreview();
        ctxSession = session;
        var menu = el('ctx-menu');
        clear(menu);
        menuItem(menu, '打开', function () { openSession(session); });
        menuItem(menu, '重命名', function () { action('rename', session); });
        menuItem(menu, session.pinned ? '取消置顶' : '置顶', function () {
          action(session.pinned ? 'unpin' : 'pin', session);
        });
        var separator = document.createElement('div');
        separator.className = 'menu-sep';
        menu.appendChild(separator);
        if (session.archived) {
          menuItem(menu, '取消归档', function () { action('unarchive', session); });
          menuItem(menu, '删除', function () { action('delete', session); });
        } else {
          menuItem(menu, '归档', function () { action('archive', session); });
        }

        menu.classList.remove('hidden');
        menu.style.left = '0px';
        menu.style.top = '0px';
        var x;
        var y;
        if (typeof anchor.clientX === 'number') {
          x = anchor.clientX;
          y = anchor.clientY;
        } else {
          var rect = anchor.getBoundingClientRect();
          x = rect.left;
          y = rect.bottom;
        }
        var width = menu.offsetWidth;
        var height = menu.offsetHeight;
        menu.style.left = Math.max(4, Math.min(x, window.innerWidth - width - 4)) + 'px';
        menu.style.top = Math.max(4, Math.min(y, window.innerHeight - height - 4)) + 'px';
      }

      function showCwdMenu() {
        var menu = el('cwd-menu');
        clear(menu);
        if (!data) return;
        var total = 0;
        for (var i = 0; i < data.cwds.length; i += 1) total += data.cwds[i].count;
        addCwdItem(menu, null, '全部目录', total, data.cwdFilter.length === 0);
        for (var j = 0; j < data.cwds.length; j += 1) {
          var option = data.cwds[j];
          addCwdItem(
            menu,
            option.path,
            option.label,
            option.count,
            data.cwdFilter.indexOf(option.path) >= 0
          );
        }
        menu.classList.remove('hidden');
        var rect = el('cwd-filter').getBoundingClientRect();
        menu.style.maxHeight = Math.max(80, window.innerHeight - rect.bottom - 8) + 'px';
        menu.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 4)) + 'px';
        menu.style.top = (rect.bottom + 2) + 'px';
      }

      function addCwdItem(menu, path, label, count, active) {
        var item = document.createElement('button');
        item.className = 'menu-item cwd-item';
        item.setAttribute('role', 'menuitemcheckbox');
        item.setAttribute('aria-checked', active ? 'true' : 'false');
        if (active) item.classList.add('active');
        if (path) item.title = path;
        var check = document.createElement('span');
        check.className = 'check';
        check.textContent = active ? '✓' : '';
        var text = document.createElement('span');
        text.className = 'label';
        text.textContent = label;
        var sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = String(count);
        item.appendChild(check);
        item.appendChild(text);
        item.appendChild(sub);
        item.onclick = function (event) {
          // 多选：点目录只切换选中状态，菜单不关闭
          event.stopPropagation();
          post(path ? { type: 'toggleCwd', cwd: path } : { type: 'clearCwd' });
        };
        menu.appendChild(item);
      }

      function hideMenus() {
        el('cwd-menu').classList.add('hidden');
        el('ctx-menu').classList.add('hidden');
        ctxSession = null;
      }

      function updateTimes(times) {
        var nodes = document.querySelectorAll('.row-time');
        for (var i = 0; i < nodes.length; i += 1) {
          var id = nodes[i].getAttribute('data-session-id');
          if (id && times[id]) nodes[i].textContent = times[id];
        }
      }

      appendIcon(el('new-session-icon'), 'plus');
      appendIcon(el('search-icon'), 'search');
      appendIcon(el('clear-search'), 'close');
      appendIcon(el('cwd-filter-icon'), 'filter');
      appendIcon(el('cwd-chip-clear'), 'close');

      el('new-session').onclick = function () { post({ type: 'newSession' }); };
      el('search').addEventListener('input', function (event) {
        post({ type: 'setFilter', value: event.target.value });
      });
      el('clear-search').onclick = function () {
        el('search').value = '';
        post({ type: 'setFilter', value: '' });
        el('search').focus();
      };
      el('cwd-filter').onclick = function (event) {
        event.stopPropagation();
        var menu = el('cwd-menu');
        if (menu.classList.contains('hidden')) {
          hideMenus();
          showCwdMenu();
        } else {
          hideMenus();
        }
      };
      el('cwd-chip-clear').onclick = function () { post({ type: 'clearCwd' }); };

      document.addEventListener('click', function (event) {
        var target = event.target;
        if (!el('cwd-menu').contains(target) && !el('cwd-filter').contains(target)) {
          el('cwd-menu').classList.add('hidden');
        }
        if (!el('ctx-menu').contains(target)) el('ctx-menu').classList.add('hidden');
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') hideMenus();
      });

      window.addEventListener('message', function (event) {
        var message = event.data;
        if (!message) return;
        if (message.type === 'render') render(message);
        else if (message.type === 'times') updateTimes(message.times || {});
        else if (message.type === 'preview' && message.requestId === hoverRequestId && hoverRow) {
          showPreview(message.messages, message.reply);
        }
        else if (message.type === 'focusSearch') el('search').focus();
      });

      setInterval(function () {
        if (data) post({ type: 'tick' });
      }, 30000);

      post({ type: 'ready' });
    }());
  </script>
</body>
</html>`;
}
