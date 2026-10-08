/**
 * 会话侧栏（F3）：新对话 + 搜索 + 时间分组 + 行悬浮操作（重命名/删除）+ 折叠。
 * - 会话标题取 meta.title，无 title 显示截断 id；
 * - 时间分组：今天 / 近 7 天 / 更早；相对时间（刚刚/N 分钟前/昨天/日期）；
 * - 重命名内联输入（Enter 确认 / Esc 取消）；删除有确认小弹层；
 * - 折叠态约 64px 图标列（会话首字符按钮 + 展开按钮）。
 */

import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import type { SessionSummary, TimeLike } from '../types';
import { EditIcon, PanelIcon, PlusIcon, SearchIcon, TrashIcon } from './icons';

export interface SidebarProps {
  sessions: SessionSummary[];
  activeId: string;
  collapsed: boolean;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  onToggleCollapse: () => void;
}

function label(sessionId: string): string {
  return sessionId.length > 18 ? `${sessionId.slice(0, 12)}…${sessionId.slice(-4)}` : sessionId;
}

function titleOf(session: SessionSummary): string {
  const title = session.title?.trim();
  return title && title.length > 0 ? title : label(session.sessionId);
}

/** 时间字段兼容 epoch 毫秒 / ISO 字符串。 */
function toMillis(value: TimeLike): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function sessionTime(session: SessionSummary): number | undefined {
  return toMillis(session.lastEventAt) ?? toMillis(session.createdAt);
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) {
    return '刚刚';
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  const date = new Date(ms);
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (isToday) {
    return `${Math.floor(diff / 3_600_000)} 小时前`;
  }
  const yesterday = new Date(today.getTime() - 86_400_000);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) {
    return '昨天';
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

type GroupName = '今天' | '近 7 天' | '更早';

function groupName(ms: number | undefined): GroupName {
  if (ms === undefined) {
    return '更早';
  }
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= startOfToday) {
    return '今天';
  }
  if (ms >= startOfToday - 6 * 86_400_000) {
    return '近 7 天';
  }
  return '更早';
}

const GROUP_ORDER: GroupName[] = ['今天', '近 7 天', '更早'];

export default function Sidebar({
  sessions,
  activeId,
  collapsed,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onToggleCollapse,
}: SidebarProps): ReactElement {
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Enter/Esc 提交后输入框卸载会再触发一次 onBlur（闭包里还是旧值），
  // 用一次性闸门挡住重复提交/把已放弃的草稿又提交出去
  const renameSettledRef = useRef(false);

  const keyword = query.trim().toLowerCase();
  const filtered = keyword
    ? sessions.filter(
        (session) =>
          session.sessionId.toLowerCase().includes(keyword) ||
          (session.title ?? '').toLowerCase().includes(keyword),
      )
    : sessions;

  const grouped = new Map<GroupName, SessionSummary[]>();
  for (const session of filtered) {
    const group = groupName(sessionTime(session));
    const bucket = grouped.get(group);
    if (bucket) {
      bucket.push(session);
    } else {
      grouped.set(group, [session]);
    }
  }

  const startRename = (session: SessionSummary): void => {
    setConfirmDeleteId(null);
    renameSettledRef.current = false;
    setRenamingId(session.sessionId);
    setRenameDraft(session.title ?? '');
  };

  const commitRename = (): void => {
    if (renameSettledRef.current) {
      return;
    }
    renameSettledRef.current = true;
    const id = renamingId;
    setRenamingId(null);
    if (id) {
      const title = renameDraft.trim();
      if (title) {
        onRename(id, title);
      }
    }
  };

  const cancelRename = (): void => {
    renameSettledRef.current = true;
    setRenamingId(null);
    setRenameDraft('');
  };

  const handleRenameKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      // Esc 只取消重命名，不停止生成（吞掉事件，App 全局快捷键不可见）
      e.preventDefault();
      e.stopPropagation();
      cancelRename();
    }
  };

  const renderRow = (session: SessionSummary): ReactElement => {
    const time = sessionTime(session);
    const active = session.sessionId === activeId;
    if (renamingId === session.sessionId) {
      return (
        <div key={session.sessionId} className="sidebar__row sidebar__row--active">
          <input
            className="sidebar__rename"
            value={renameDraft}
            autoFocus
            aria-label="重命名会话"
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commitRename}
          />
        </div>
      );
    }
    return (
      <div
        key={session.sessionId}
        className={active ? 'sidebar__row sidebar__row--active' : 'sidebar__row'}
      >
        <button
          type="button"
          className="sidebar__item"
          title={titleOf(session)}
          onClick={() => onSelect(session.sessionId)}
        >
          <span className="sidebar__item-title sidebar__item-title--plain">
            {titleOf(session)}
          </span>
          <span className="sidebar__item-meta">
            {time !== undefined ? relativeTime(time) : ''}
            {` · ${session.eventCount ?? session.events} 事件`}
          </span>
        </button>
        <div className="sidebar__actions">
          <button
            type="button"
            className="sidebar__action"
            title="重命名"
            aria-label="重命名会话"
            onClick={() => startRename(session)}
          >
            <EditIcon />
          </button>
          <button
            type="button"
            className="sidebar__action sidebar__action--danger"
            title="删除"
            aria-label="删除会话"
            onClick={() => setConfirmDeleteId(session.sessionId)}
          >
            <TrashIcon />
          </button>
        </div>
        {confirmDeleteId === session.sessionId ? (
          <div className="sidebar__confirm" role="dialog" aria-label="删除确认">
            删除会话「{titleOf(session)}」？事件记录保留可审计。
            <div className="sidebar__confirm-actions">
              <button
                type="button"
                className="btn btn--small"
                onClick={() => setConfirmDeleteId(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn--small btn--danger"
                onClick={() => {
                  setConfirmDeleteId(null);
                  onDelete(session.sessionId);
                }}
              >
                删除
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const renderCollapsedRow = (session: SessionSummary): ReactElement => (
    <div
      key={session.sessionId}
      className={session.sessionId === activeId ? 'sidebar__row sidebar__row--active' : 'sidebar__row'}
    >
      <button
        type="button"
        className="sidebar__item"
        title={titleOf(session)}
        onClick={() => onSelect(session.sessionId)}
      >
        <span className="sidebar__item-title sidebar__item-title--plain">
          {titleOf(session).slice(0, 1)}
        </span>
      </button>
    </div>
  );

  return (
    <aside className={collapsed ? 'sidebar sidebar--collapsed' : 'sidebar'}>
      <button
        type="button"
        className="icon-btn"
        title={collapsed ? '展开侧栏' : '折叠侧栏'}
        aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
        onClick={onToggleCollapse}
      >
        <PanelIcon />
      </button>
      <button type="button" className="sidebar__new" onClick={onNew} title="新对话（Ctrl+N）">
        {collapsed ? <PlusIcon /> : (
          <>
            <span aria-hidden="true">＋</span> 新对话
          </>
        )}
      </button>
      {!collapsed ? (
        <input
          className="sidebar__search"
          value={query}
          placeholder="搜索会话"
          aria-label="搜索会话"
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      {!collapsed ? <div className="sidebar__section">会话</div> : null}
      <nav className="sidebar__list">
        {filtered.length === 0 ? (
          <div className="sidebar__empty">
            {keyword ? '无匹配会话' : '暂无历史会话'}
          </div>
        ) : (
          GROUP_ORDER.filter((group) => (grouped.get(group) ?? []).length > 0).map((group) => (
            <div key={group}>
              {!collapsed ? <div className="sidebar__group">{group}</div> : null}
              {(grouped.get(group) ?? []).map((session) =>
                collapsed ? renderCollapsedRow(session) : renderRow(session),
              )}
            </div>
          ))
        )}
      </nav>
      {!collapsed ? (
        <div className="sidebar__foot">
          <SearchIcon />
          <span>共 {sessions.length} 个会话</span>
        </div>
      ) : null}
    </aside>
  );
}
