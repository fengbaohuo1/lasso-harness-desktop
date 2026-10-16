/**
 * 侧栏（P10-1 重写）：对齐 dsh 主页面的左栏骨架。
 *
 * 结构（自上而下）：品牌行 → 「新会话」主按钮 → 「插件」入口 → 「工作区」段头（搜索/排序/新建三个图标）
 * → 工作区分组树（组内嵌会话，单行：标题左、相对时间右，悬浮出重命名/删除）→ 底部（主题/设置/服务状态）。
 *
 * 数据都由 App 持有，本组件只做呈现与交互转发（重命名保留行内输入，避免再开弹层）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { SessionSummary, WorkspaceItem } from '../types';
import { THEME_MODE_LABEL } from '../lib/theme';
import type { ThemeMode } from '../lib/theme';
import {
  ChevronIcon,
  EditIcon,
  GearIcon,
  MonitorIcon,
  MoonIcon,
  NewChatIcon,
  PanelIcon,
  PluginIcon,
  PlusIcon,
  SearchIcon,
  SortIcon,
  SunIcon,
  TrashIcon,
  WorkspaceIcon,
} from './icons';

/** 默认工作区码（后端 WorkspaceEntry.DEFAULT_CODE）。 */
const DEFAULT_WORKSPACE = 'default';

/** 会话排序模式（P10-1：段头排序图标循环切换，localStorage 记忆）。 */
type SortMode = 'recent' | 'name';
const SORT_KEY = 'jnf-session-sort';
const SORT_LABEL: Record<SortMode, string> = { recent: '按最近活动', name: '按名称' };

interface Props {
  sessions: SessionSummary[];
  workspaces: WorkspaceItem[];
  activeId: string | null;
  collapsed: boolean;
  themeMode: ThemeMode;
  /** 服务状态文案（如「服务运行中 · :39217」）。 */
  serviceLabel: string;
  serviceRunning: boolean;
  /** 插件计数徽标（0 时不显示）。 */
  pluginCount: number;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  onToggleCollapse: () => void;
  onOpenPlugins: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onNewWorkspace: () => void;
  onEditWorkspace: (workspace: WorkspaceItem) => void;
  onDeleteWorkspace: (workspace: WorkspaceItem) => void;
}

/* ----------------------------- 时间与标题工具 ----------------------------- */

function toMillis(value: number | string | null | undefined): number {
  if (value == null) {
    return 0;
  }
  if (typeof value === 'number') {
    return value < 1e12 ? Math.round(value * 1000) : value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 会话活动时间（优先 lastEventAt，回落 createdAt）。 */
function sessionTime(session: SessionSummary): number {
  return toMillis(session.lastEventAt) || toMillis(session.createdAt);
}

/** 紧凑相对时间（对齐 dsh：刚刚 / 12分 / 3时 / 2天 / 月-日）。 */
function compactTime(millis: number): string {
  if (!millis) {
    return '';
  }
  const diff = Date.now() - millis;
  if (diff < 60_000) {
    return '刚刚';
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}分`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}时`;
  }
  if (diff < 30 * 86_400_000) {
    return `${Math.floor(diff / 86_400_000)}天`;
  }
  const date = new Date(millis);
  return `${date.getMonth() + 1}-${date.getDate()}`;
}

function titleOf(session: SessionSummary): string {
  const title = (session.title ?? '').trim();
  return title || '未命名会话';
}

/** 会话行悬浮提示：标题 + 事件数 + 绝对时间（列表里只留标题与相对时间，保持单行清爽）。 */
function hintOf(session: SessionSummary): string {
  const count = session.eventCount ?? session.events ?? 0;
  const stamp = new Date(sessionTime(session)).toLocaleString('zh-CN', { hour12: false });
  return `${titleOf(session)}${count > 0 ? ` · ${count} 事件` : ''} · ${stamp}`;
}

function loadSortMode(): SortMode {
  try {
    return window.localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'recent';
  } catch {
    return 'recent';
  }
}

export default function Sidebar({
  sessions,
  workspaces,
  activeId,
  collapsed,
  themeMode,
  serviceLabel,
  serviceRunning,
  pluginCount,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onToggleCollapse,
  onOpenPlugins,
  onOpenSettings,
  onToggleTheme,
  onNewWorkspace,
  onEditWorkspace,
  onDeleteWorkspace,
}: Props): ReactElement {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>(loadSortMode);
  /** 已折叠的工作区码（默认全展开）。 */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  /** 一次性闸门：Enter 提交后 onBlur 会再触发一次，避免重复提交。 */
  const renameSettledRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus();
    }
  }, [searchOpen]);

  const cycleSort = (): void => {
    const next: SortMode = sortMode === 'recent' ? 'name' : 'recent';
    setSortMode(next);
    try {
      window.localStorage.setItem(SORT_KEY, next);
    } catch {
      // 忽略隐私模式下的写入失败
    }
  };

  const keyword = query.trim().toLowerCase();

  /** 工作区分组：先按工作区列，再把会话挂到各自工作区；无工作区码/码失效的会话归默认组。 */
  const groups = useMemo(() => {
    const byCode = new Map<string, SessionSummary[]>();
    for (const session of sessions) {
      const code = session.workspaceCode && workspaces.some((w) => w.workspaceCode === session.workspaceCode)
        ? session.workspaceCode
        : DEFAULT_WORKSPACE;
      const list = byCode.get(code);
      if (list) {
        list.push(session);
      } else {
        byCode.set(code, [session]);
      }
    }
    const ordered = [...workspaces].sort((a, b) => {
      if (a.workspaceCode === DEFAULT_WORKSPACE) {
        return -1;
      }
      if (b.workspaceCode === DEFAULT_WORKSPACE) {
        return 1;
      }
      return a.displayName.localeCompare(b.displayName, 'zh-Hans-CN');
    });
    return ordered.map((workspace) => {
      const raw = byCode.get(workspace.workspaceCode) ?? [];
      const filtered = keyword
        ? raw.filter((session) => titleOf(session).toLowerCase().includes(keyword))
        : raw;
      const sorted = [...filtered].sort((a, b) =>
        sortMode === 'name'
          ? titleOf(a).localeCompare(titleOf(b), 'zh-Hans-CN')
          : sessionTime(b) - sessionTime(a),
      );
      return { workspace, sessions: sorted, total: raw.length };
    });
  }, [sessions, workspaces, keyword, sortMode]);

  /** 搜索时也按工作区名过滤整组（搜「docs」要能看到 docs 组）。 */
  const visibleGroups = keyword
    ? groups.filter(
        (group) =>
          group.sessions.length > 0 ||
          group.workspace.displayName.toLowerCase().includes(keyword) ||
          group.workspace.workspaceCode.toLowerCase().includes(keyword),
      )
    : groups;

  const startRename = (session: SessionSummary): void => {
    renameSettledRef.current = false;
    setRenamingId(session.sessionId);
    setRenameDraft(titleOf(session));
  };

  const commitRename = (): void => {
    if (!renamingId || renameSettledRef.current) {
      return;
    }
    renameSettledRef.current = true;
    const next = renameDraft.trim();
    const id = renamingId;
    setRenamingId(null);
    if (next) {
      onRename(id, next);
    }
  };

  const toggleGroup = (code: string): void => {
    setCollapsedGroups((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const ThemeIcon = themeMode === 'system' ? MonitorIcon : themeMode === 'dark' ? MoonIcon : SunIcon;

  /* ----------------------------- 折叠态 ----------------------------- */

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed">
        <div className="sidebar__brand sidebar__brand--rail">
          <span className="sidebar__logo-mark">◆</span>
        </div>
        <button type="button" className="icon-btn icon-btn--lg" title="展开侧栏" onClick={onToggleCollapse}>
          <PanelIcon />
        </button>
        <button type="button" className="icon-btn icon-btn--lg" title="新会话" onClick={onNew}>
          <NewChatIcon />
        </button>
        <button type="button" className="icon-btn icon-btn--lg" title="插件" onClick={onOpenPlugins}>
          <PluginIcon />
        </button>
        <div className="sidebar__rail" />
        {groups.map((group) => (
          <button
            key={group.workspace.workspaceCode}
            type="button"
            className="icon-btn icon-btn--lg"
            title={`${group.workspace.displayName}（${group.total}）· 点击展开侧栏`}
            onClick={onToggleCollapse}
          >
            <WorkspaceIcon />
          </button>
        ))}
        <div className="sidebar__spacer" />
        <button
          type="button"
          className="icon-btn icon-btn--lg"
          title={`主题：${THEME_MODE_LABEL[themeMode]}`}
          onClick={onToggleTheme}
        >
          <ThemeIcon />
        </button>
        <button type="button" className="icon-btn icon-btn--lg" title="设置" onClick={onOpenSettings}>
          <GearIcon />
        </button>
        <span className={`status-dot${serviceRunning ? ' status-dot--on' : ''}`} title={serviceLabel} />
      </aside>
    );
  }

  /* ----------------------------- 展开态 ----------------------------- */

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__logo">
          <span className="sidebar__logo-mark">◆</span>
          jnf
          <span className="sidebar__logo-tag">HARNESS</span>
        </span>
        <button type="button" className="icon-btn" title="折叠侧栏" onClick={onToggleCollapse}>
          <PanelIcon />
        </button>
      </div>

      <button type="button" className="sidebar__cta" onClick={onNew}>
        <NewChatIcon />
        <span>新会话</span>
      </button>

      <button type="button" className="sidebar__entry" onClick={onOpenPlugins}>
        <PluginIcon />
        <span>插件</span>
        {pluginCount > 0 ? <span className="sidebar__entry-count">{pluginCount}</span> : null}
      </button>

      <div className="sidebar__secthead">
        <span className="sidebar__secthead-title">工作区</span>
        <span className="sidebar__sectacts">
          <button
            type="button"
            className={`icon-btn${searchOpen ? ' icon-btn--active' : ''}`}
            title="搜索会话"
            onClick={() => setSearchOpen((prev) => !prev)}
          >
            <SearchIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={`排序：${SORT_LABEL[sortMode]}（点击切换）`}
            onClick={cycleSort}
          >
            <SortIcon />
          </button>
          <button type="button" className="icon-btn" title="新建工作区" onClick={onNewWorkspace}>
            <PlusIcon />
          </button>
        </span>
      </div>

      {searchOpen ? (
        <input
          ref={searchRef}
          className="sidebar__search"
          value={query}
          placeholder="搜索会话或工作区"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('');
              setSearchOpen(false);
            }
          }}
        />
      ) : null}

      <div className="sidebar__tree">
        {visibleGroups.map((group) => {
          const code = group.workspace.workspaceCode;
          const open = !collapsedGroups[code];
          return (
            <div className="wsgroup" key={code}>
              <div className="wsgroup__head">
                <button
                  type="button"
                  className="wsgroup__toggle"
                  title={open ? '折叠' : '展开'}
                  onClick={() => toggleGroup(code)}
                >
                  <span className={`wsgroup__chev${open ? ' wsgroup__chev--open' : ''}`}>
                    <ChevronIcon />
                  </span>
                  <span className="wsgroup__name" title={group.workspace.rootPath}>
                    {group.workspace.displayName}
                  </span>
                  <span className="wsgroup__count">{group.total}</span>
                </button>
                <span className="wsgroup__acts">
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    title="编辑工作区"
                    onClick={() => onEditWorkspace(group.workspace)}
                  >
                    <EditIcon />
                  </button>
                  {code === DEFAULT_WORKSPACE ? null : (
                    <button
                      type="button"
                      className="icon-btn icon-btn--sm"
                      title="删除工作区"
                      onClick={() => onDeleteWorkspace(group.workspace)}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </span>
              </div>

              {open ? (
                <div className="wsgroup__sessions">
                  {group.sessions.map((session) => {
                    const active = session.sessionId === activeId;
                    if (session.sessionId === renamingId) {
                      return (
                        <div className="session session--editing" key={session.sessionId}>
                          <input
                            className="session__rename"
                            value={renameDraft}
                            autoFocus
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                commitRename();
                              } else if (e.key === 'Escape') {
                                renameSettledRef.current = true;
                                setRenamingId(null);
                              }
                            }}
                          />
                        </div>
                      );
                    }
                    return (
                      <div
                        className={`session${active ? ' session--active' : ''}`}
                        key={session.sessionId}
                        title={hintOf(session)}
                        onClick={() => onSelect(session.sessionId)}
                      >
                        <span className="session__title">{titleOf(session)}</span>
                        <span className="session__time">{compactTime(sessionTime(session))}</span>
                        <span className="session__acts">
                          <button
                            type="button"
                            className="icon-btn icon-btn--sm"
                            title="重命名"
                            onClick={(e) => {
                              e.stopPropagation();
                              startRename(session);
                            }}
                          >
                            <EditIcon />
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn--sm"
                            title="删除会话"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(session.sessionId);
                            }}
                          >
                            <TrashIcon />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                  {group.sessions.length === 0 ? (
                    <p className="wsgroup__empty">{keyword ? '无匹配会话' : '暂无会话'}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {visibleGroups.length === 0 ? <p className="wsgroup__empty">无匹配工作区</p> : null}
      </div>

      <div className="sidebar__foot">
        <button type="button" className="sidebar__footrow" onClick={onToggleTheme}>
          <ThemeIcon />
          <span>主题</span>
          <span className="sidebar__footrow-value">{THEME_MODE_LABEL[themeMode]}</span>
        </button>
        <button type="button" className="sidebar__footrow" onClick={onOpenSettings}>
          <GearIcon />
          <span>设置</span>
        </button>
        <div className="sidebar__status" title={serviceLabel}>
          <span className={`status-dot${serviceRunning ? ' status-dot--on' : ''}`} />
          <span className="sidebar__status-text">{serviceLabel}</span>
        </div>
      </div>
    </aside>
  );
}
