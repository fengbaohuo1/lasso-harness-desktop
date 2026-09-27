/**
 * 会话侧栏（M7.2）：新对话 + 会话列表（源 /api/harness/console/sessions）。
 * 点击切换会话并加载回放；当前会话高亮。
 */

import type { ReactElement } from 'react';
import type { SessionSummary } from '../types';

export interface SidebarProps {
  sessions: SessionSummary[];
  activeId: string;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
}

function label(sessionId: string): string {
  return sessionId.length > 18 ? `${sessionId.slice(0, 12)}…${sessionId.slice(-4)}` : sessionId;
}

export default function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
}: SidebarProps): ReactElement {
  return (
    <aside className="sidebar">
      <button type="button" className="sidebar__new" onClick={onNew}>
        <span aria-hidden="true">＋</span> 新对话
      </button>
      <div className="sidebar__section">会话</div>
      <nav className="sidebar__list">
        {sessions.length === 0 ? (
          <div className="sidebar__empty">暂无历史会话</div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.sessionId}
              type="button"
              className={
                session.sessionId === activeId
                  ? 'sidebar__item sidebar__item--active'
                  : 'sidebar__item'
              }
              onClick={() => onSelect(session.sessionId)}
            >
              <span className="sidebar__item-title">{label(session.sessionId)}</span>
              <span className="sidebar__item-meta">{session.events} 事件</span>
            </button>
          ))
        )}
      </nav>
    </aside>
  );
}
