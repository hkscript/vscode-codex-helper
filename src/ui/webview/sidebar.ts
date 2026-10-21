/**
 * 侧边栏 webview 里跑的脚本（esbuild 按 iife 打到 dist/webview/sidebar.js）。
 *
 * 这里只管 DOM：搜索行、目录筛选、分组列表、右键菜单和悬停摘要；数据与动作全部走
 * `./protocol` 里的消息，由扩展宿主处理。
 */
import type {
  HostMessage,
  RenderMessage,
  SessionAction,
  SessionGroupData,
  SessionRowData,
  WebviewMessage,
} from './protocol';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
let data: RenderMessage | null = null;
let expanded: Record<string, boolean> = {};
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hoverRow: HTMLElement | null = null;
let hoverRequestId = 0;

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(path: string): SVGSVGElement {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', '0 0 16 16');
  node.setAttribute('width', '14');
  node.setAttribute('height', '14');
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '1.25');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', path);
  node.appendChild(shape);
  return node;
}
const ICONS = {
  plus: 'M8 2.5v11M2.5 8h11',
  search: 'M7 12.2a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4Zm3.8-1.4 3 3',
  filter: 'M2.5 3.5h11L9 8.7v3.4l-2 .9V8.7L2.5 3.5Z',
  close: 'M3.5 3.5l9 9m0-9-9 9',
};

function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}
function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
function basename(path: string): string {
  const parts = String(path || '')
    .split(/[\\/]+/)
    .filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}
function appendIcon(host: HTMLElement, name: keyof typeof ICONS): void {
  host.appendChild(svg(ICONS[name]));
}

function render(payload: RenderMessage): void {
  data = payload;
  expanded = payload.expanded || {};
  hidePreview();
  if (document.activeElement !== el('search')) {
    el<HTMLInputElement>('search').value = payload.filter || '';
  }
  el('clear-search').classList.toggle('hidden', !(payload.filter || '').length);
  el('cwd-filter').classList.toggle('active', (payload.cwdFilter || []).length > 0);
  renderCwdChip(payload);
  renderList(payload);
  // 多选目录时菜单要保持打开；重绘后按新状态重建它
  el('ctx-menu').classList.add('hidden');
  if (!el('cwd-menu').classList.contains('hidden')) showCwdMenu();
}

function renderCwdChip(payload: RenderMessage): void {
  const chip = el('cwd-chip');
  const selected = payload.cwdFilter || [];
  el('cwd-filter').classList.toggle('hidden', selected.length > 0);
  if (selected.length === 0) {
    chip.classList.add('hidden');
    return;
  }
  // 只选一个目录时只显示目录名，避免「过滤 foo」这种冗余前缀
  el('cwd-chip-prefix').classList.toggle('hidden', selected.length === 1);
  el('cwd-chip-label').textContent =
    selected.length === 1 ? basename(selected[0]!) : selected.length + ' 个目录';
  el('cwd-chip-label').title = selected.join('\n');
  chip.classList.remove('hidden');
}

function renderList(payload: RenderMessage): void {
  const list = el('list');
  const scrollTop = list.scrollTop;
  clear(list);

  if (payload.error) {
    list.appendChild(errorBox(payload.error));
    if (!payload.groups || payload.groups.length === 0) return;
  }
  if (payload.loading && (!payload.groups || payload.groups.length === 0)) {
    list.appendChild(status('加载中…'));
    return;
  }
  const filtering =
    (payload.filter || '').trim().length > 0 || (payload.cwdFilter || []).length > 0;
  if (!payload.groups || payload.groups.length === 0) {
    list.appendChild(
      status(filtering ? (payload.loadingAll ? '正在加载全部会话…' : '没有匹配的会话') : '还没有会话'),
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
  const pinned = payload.groups.filter((group) => group.id === 'pinned');
  const recent = payload.groups.find((group) => group.id === 'recent');
  const history = payload.groups.filter((group) => group.id === 'history');
  const archived = payload.groups.filter((group) => group.id === 'archived');
  for (const group of pinned) {
    for (const session of group.sessions) list.appendChild(sessionRow(session));
  }
  if (recent) {
    for (const session of recent.sessions) list.appendChild(sessionRow(session));
  }
  for (const group of history) list.appendChild(groupNode(group));
  if (!filtering && payload.hasMore) list.appendChild(loadMoreButton(false, '加载更多'));
  for (const group of archived) list.appendChild(groupNode(group));
  if (!filtering && payload.archivedHasMore) {
    list.appendChild(loadMoreButton(true, '加载更多已归档'));
  }
  if (filtering && payload.loadingAll) list.appendChild(status('正在加载全部会话…'));
  syncLoadMoreVisibility(payload);
  list.scrollTop = scrollTop;
}

function loadMoreButton(archived: boolean, label: string): HTMLButtonElement {
  const more = document.createElement('button');
  more.className = 'load-more';
  more.dataset.kind = archived ? 'archived' : 'unarchived';
  more.textContent = label;
  more.onclick = () => {
    post({ type: 'loadMore', archived });
  };
  return more;
}

function syncLoadMoreVisibility(payload: RenderMessage): void {
  const unarchivedMore = document.querySelector('.load-more[data-kind="unarchived"]');
  if (unarchivedMore) {
    const hasHistory = (payload.groups || []).some((group) => group.id === 'history');
    unarchivedMore.classList.toggle('hidden', hasHistory && expanded.history === false);
  }
  const archivedMore = document.querySelector('.load-more[data-kind="archived"]');
  if (archivedMore) {
    const hasArchived = (payload.groups || []).some((group) => group.id === 'archived');
    archivedMore.classList.toggle('hidden', hasArchived && expanded.archived === false);
  }
}

function status(text: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = 'status';
  node.textContent = text;
  return node;
}

function errorBox(message: string): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'error';
  const text = document.createElement('div');
  text.textContent = '加载失败：' + message;
  const retry = document.createElement('button');
  retry.textContent = '重试';
  retry.onclick = () => post({ type: 'retry' });
  box.appendChild(text);
  box.appendChild(retry);
  return box;
}

function groupNode(group: SessionGroupData): HTMLElement {
  const section = document.createElement('section');
  section.setAttribute('role', 'group');
  const open = expanded[group.id] !== false;

  const head = document.createElement('button');
  head.className = 'group-head';
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.textContent = open ? '▾' : '▸';
  const label = document.createElement('span');
  label.className = 'group-label';
  label.textContent = group.label;
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = String(group.sessions.length);
  head.appendChild(chevron);
  head.appendChild(label);
  head.appendChild(count);

  const body = document.createElement('div');
  body.className = 'group-body';
  if (open) {
    for (const session of group.sessions) body.appendChild(sessionRow(session));
  }

  head.onclick = () => {
    const next = expanded[group.id] === false;
    expanded[group.id] = next;
    chevron.textContent = next ? '▾' : '▸';
    head.setAttribute('aria-expanded', next ? 'true' : 'false');
    clear(body);
    if (next) {
      for (const session of group.sessions) body.appendChild(sessionRow(session));
    }
    if (data) syncLoadMoreVisibility(data);
    post({ type: 'toggleGroup', id: group.id, expanded: next });
  };

  section.appendChild(head);
  section.appendChild(body);
  return section;
}

function sessionRow(session: SessionRowData): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  row.tabIndex = 0;
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-label', session.label || session.id);
  row.dataset.sessionId = session.id;

  const title = document.createElement('span');
  title.className = 'row-title';
  if (session.pinned) {
    const pin = document.createElement('span');
    pin.className = 'pin';
    pin.textContent = '📌';
    title.appendChild(pin);
  }
  title.appendChild(document.createTextNode(session.label || session.id));

  const running = session.running ? document.createElement('span') : null;
  if (running) {
    running.className = 'row-running';
    running.title = '运行中';
    running.setAttribute('aria-label', '运行中');
  }

  const time = document.createElement('span');
  time.className = 'row-time';
  time.dataset.sessionId = session.id;
  time.textContent = session.time || '';

  const more = document.createElement('button');
  more.className = 'row-more';
  more.title = '更多操作';
  more.setAttribute('aria-label', '更多操作');
  more.textContent = '⋯';
  more.onclick = (event) => {
    event.stopPropagation();
    showContextMenu(session, more);
  };

  if (running) row.appendChild(running);
  row.appendChild(title);
  row.appendChild(time);
  row.appendChild(more);
  row.onclick = () => openSession(session);
  row.onmouseenter = () => schedulePreview(session, row);
  row.onmouseleave = () => hidePreview();
  row.onfocus = () => schedulePreview(session, row);
  row.onblur = () => hidePreview();
  row.oncontextmenu = (event) => {
    event.preventDefault();
    showContextMenu(session, event);
  };
  row.onkeydown = (event) => {
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

function moveFocus(row: HTMLElement, delta: number): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.row'));
  const index = rows.indexOf(row);
  const next = rows[index + delta];
  if (next) next.focus();
}

function schedulePreview(session: SessionRowData, row: HTMLElement): void {
  // 右键菜单打开期间不要弹悬停摘要，避免两个浮层叠在一起
  if (!el('ctx-menu').classList.contains('hidden')) return;
  if (hoverTimer) clearTimeout(hoverTimer);
  el('session-tooltip').classList.add('hidden');
  hoverRow = row;
  const requestId = ++hoverRequestId;
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    if (hoverRow !== row) return;
    post({
      type: 'preview',
      sessionId: session.id,
      updatedAt: session.updatedAt,
      requestId,
    });
  }, 250);
}

function hidePreview(): void {
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = null;
  hoverRow = null;
  hoverRequestId += 1;
  el('session-tooltip').classList.add('hidden');
}

function showPreview(messages: string[] | undefined, reply: string | null | undefined): void {
  if (!hoverRow) return;
  const tip = el('session-tooltip');
  clear(tip);
  const list = messages || [];
  if (list.length === 0 && !reply) {
    const empty = document.createElement('div');
    empty.className = 'tooltip-empty';
    empty.textContent = '没有找到可显示的会话内容';
    tip.appendChild(empty);
  } else {
    const labels =
      list.length === 1
        ? ['首次输入']
        : list.length === 2
          ? ['首次输入', '最后输入']
          : ['首次输入', '二次输入', '最后输入'];
    for (let i = 0; i < list.length; i += 1) {
      appendPreviewSection(tip, labels[i] || '用户输入', list[i]);
    }
    if (reply) {
      appendPreviewSection(tip, '模型回复', reply);
    }
  }
  tip.classList.remove('hidden');
  const rect = hoverRow.getBoundingClientRect();
  tip.style.left = '0px';
  tip.style.top = '0px';
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  const left = Math.max(4, Math.min(rect.left + 22, window.innerWidth - width - 6));
  let top = rect.bottom + 4;
  if (top + height > window.innerHeight - 4) top = Math.max(4, rect.top - height - 4);
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function appendPreviewSection(tip: HTMLElement, label: string, value: string | null | undefined): void {
  const section = document.createElement('div');
  section.className = 'tooltip-section';
  const tag = document.createElement('span');
  tag.className = 'tooltip-label';
  tag.textContent = label;
  const text = document.createElement('span');
  text.className = 'tooltip-text';
  const content = String(value || '');
  text.textContent = content.length > 400 ? content.slice(0, 397) + '…' : content;
  section.appendChild(tag);
  section.appendChild(text);
  tip.appendChild(section);
}

function openSession(session: SessionRowData): void {
  post({
    type: 'open',
    session: {
      sessionId: session.id,
      label: session.label,
      archived: !!session.archived,
    },
  });
}

function menuItem(menu: HTMLElement, label: string, handler: () => void): void {
  const item = document.createElement('button');
  item.className = 'menu-item';
  item.setAttribute('role', 'menuitem');
  const text = document.createElement('span');
  text.className = 'label';
  text.textContent = label;
  item.appendChild(text);
  item.onclick = (event) => {
    event.stopPropagation();
    hideMenus();
    handler();
  };
  menu.appendChild(item);
}

function action(name: SessionAction, session: SessionRowData): void {
  post({
    type: 'action',
    action: name,
    session: { sessionId: session.id, label: session.label },
  });
}

/** 鼠标右键按指针位置弹出；键盘 / 「⋯」按钮贴着元素下沿弹出。 */
function showContextMenu(session: SessionRowData, anchor: MouseEvent | HTMLElement): void {
  hidePreview();
  const menu = el('ctx-menu');
  clear(menu);
  menuItem(menu, '打开', () => openSession(session));
  menuItem(menu, '重命名', () => action('rename', session));
  menuItem(menu, session.pinned ? '取消置顶' : '置顶', () => {
    action(session.pinned ? 'unpin' : 'pin', session);
  });
  const separator = document.createElement('div');
  separator.className = 'menu-sep';
  menu.appendChild(separator);
  if (session.archived) {
    menuItem(menu, '取消归档', () => action('unarchive', session));
    menuItem(menu, '删除', () => action('delete', session));
  } else {
    menuItem(menu, '归档', () => action('archive', session));
  }

  menu.classList.remove('hidden');
  menu.style.left = '0px';
  menu.style.top = '0px';
  let x: number;
  let y: number;
  if (anchor instanceof MouseEvent) {
    x = anchor.clientX;
    y = anchor.clientY;
  } else {
    const rect = anchor.getBoundingClientRect();
    x = rect.left;
    y = rect.bottom;
  }
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - height - 4)) + 'px';
}

function showCwdMenu(): void {
  const menu = el('cwd-menu');
  clear(menu);
  if (!data) return;
  let total = 0;
  for (const option of data.cwds) total += option.count;
  addCwdItem(menu, null, '全部目录', total, data.cwdFilter.length === 0);
  for (const option of data.cwds) {
    addCwdItem(menu, option.path, option.label, option.count, data.cwdFilter.indexOf(option.path) >= 0);
  }
  menu.classList.remove('hidden');
  const rect = el('cwd-filter').getBoundingClientRect();
  menu.style.maxHeight = Math.max(80, window.innerHeight - rect.bottom - 8) + 'px';
  menu.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 4)) + 'px';
  menu.style.top = (rect.bottom + 2) + 'px';
}

function addCwdItem(
  menu: HTMLElement,
  path: string | null,
  label: string,
  count: number,
  active: boolean,
): void {
  const item = document.createElement('button');
  item.className = 'menu-item cwd-item';
  item.setAttribute('role', 'menuitemcheckbox');
  item.setAttribute('aria-checked', active ? 'true' : 'false');
  if (active) item.classList.add('active');
  if (path) item.title = path;
  const check = document.createElement('span');
  check.className = 'check';
  check.textContent = active ? '✓' : '';
  const text = document.createElement('span');
  text.className = 'label';
  text.textContent = label;
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = String(count);
  item.appendChild(check);
  item.appendChild(text);
  item.appendChild(sub);
  item.onclick = (event) => {
    // 多选：点目录只切换选中状态，菜单不关闭
    event.stopPropagation();
    post(path ? { type: 'toggleCwd', cwd: path } : { type: 'clearCwd' });
  };
  menu.appendChild(item);
}

function hideMenus(): void {
  el('cwd-menu').classList.add('hidden');
  el('ctx-menu').classList.add('hidden');
}

function toggleCwdMenu(): void {
  const menu = el('cwd-menu');
  if (menu.classList.contains('hidden')) {
    hideMenus();
    showCwdMenu();
  } else {
    hideMenus();
  }
}

function updateTimes(times: Record<string, string>): void {
  for (const node of Array.from(document.querySelectorAll('.row-time'))) {
    const id = node.getAttribute('data-session-id');
    if (id && times[id]) node.textContent = times[id];
  }
}

function updateRunning(ids: string[]): void {
  const running = new Set(ids);
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.row'))) {
    const id = row.dataset.sessionId;
    if (!id) continue;
    const current = row.querySelector<HTMLElement>('.row-running');
    if (running.has(id)) {
      if (current) continue;
      const spinner = document.createElement('span');
      spinner.className = 'row-running';
      spinner.title = '运行中';
      spinner.setAttribute('aria-label', '运行中');
      const title = row.querySelector('.row-title');
      if (title) row.insertBefore(spinner, title);
    } else {
      current?.remove();
    }
  }
}

appendIcon(el('new-session-icon'), 'plus');
appendIcon(el('search-icon'), 'search');
appendIcon(el('clear-search'), 'close');
appendIcon(el('cwd-filter-icon'), 'filter');
appendIcon(el('cwd-chip-clear'), 'close');

el('new-session').onclick = () => post({ type: 'newSession' });
el('search').addEventListener('input', (event) => {
  post({ type: 'setFilter', value: (event.target as HTMLInputElement).value });
});
el('clear-search').onclick = () => {
  el<HTMLInputElement>('search').value = '';
  post({ type: 'setFilter', value: '' });
  el('search').focus();
};
el('search-icon').onclick = () => {
  el<HTMLInputElement>('search').focus();
};
el('cwd-filter').onclick = (event) => {
  event.stopPropagation();
  toggleCwdMenu();
};
el('cwd-chip-clear').onclick = () => post({ type: 'clearCwd' });
el('cwd-chip').onclick = (event) => {
  if (el('cwd-chip-clear').contains(event.target as Node | null)) return;
  event.stopPropagation();
  toggleCwdMenu();
};

document.addEventListener('click', (event) => {
  const target = event.target as Node | null;
  if (
    !el('cwd-menu').contains(target) &&
    !el('cwd-filter').contains(target) &&
    !el('cwd-chip').contains(target)
  ) {
    el('cwd-menu').classList.add('hidden');
  }
  if (!el('ctx-menu').contains(target)) el('ctx-menu').classList.add('hidden');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideMenus();
});

window.addEventListener('message', (event: MessageEvent<HostMessage | null | undefined>) => {
  const message = event.data;
  if (!message) return;
  if (message.type === 'render') render(message);
  else if (message.type === 'times') updateTimes(message.times || {});
  else if (message.type === 'running') updateRunning(message.ids || []);
  else if (message.type === 'preview' && message.requestId === hoverRequestId && hoverRow) {
    showPreview(message.messages, message.reply);
  } else if (message.type === 'focusSearch') el('search').focus();
});

setInterval(() => {
  if (data) post({ type: 'tick' });
}, 30000);

post({ type: 'ready' });
