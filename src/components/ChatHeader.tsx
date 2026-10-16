/**
 * 主区会话头（P10-2）：对齐 dsh 主页面的顶部条。
 *
 * 左：折叠态下的展开按钮 + 会话标题；标题下/右侧挂本会话的上下文胶囊（工作区 / 预设 / 权限）。
 * 右：新建会话、设置两个图标按钮。
 * 只做呈现——数据与动作全部由 App 传入（侧栏已经是设置入口，此处不重复顶部状态栏）。
 */

import type { ReactElement } from 'react';
import { GearIcon, NewChatIcon, PanelIcon, PresetIcon, ShieldIcon, WorkspaceIcon } from './icons';

interface Props {
  title: string;
  workspaceLabel: string | null;
  presetLabel: string | null;
  permissionLabel: string | null;
  streaming: boolean;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
}

export default function ChatHeader({
  title,
  workspaceLabel,
  presetLabel,
  permissionLabel,
  streaming,
  sidebarCollapsed,
  onExpandSidebar,
  onNewSession,
  onOpenSettings,
}: Props): ReactElement {
  return (
    <header className="chat-header">
      {sidebarCollapsed ? (
        <button type="button" className="icon-btn" title="展开侧栏" onClick={onExpandSidebar}>
          <PanelIcon />
        </button>
      ) : null}

      <div className="chat-header__main">
        <h1 className="chat-header__title" title={title}>
          {title}
        </h1>
        <div className="chat-header__meta">
          {streaming ? <span className="chat-header__live">生成中…</span> : null}
          {workspaceLabel ? (
            <span className="chat-chip" title={workspaceLabel}>
              <WorkspaceIcon />
              <span className="chat-chip__text">{workspaceLabel}</span>
            </span>
          ) : null}
          {presetLabel ? (
            <span className="chat-chip" title={`预设 ${presetLabel}`}>
              <PresetIcon />
              <span className="chat-chip__text">{presetLabel}</span>
            </span>
          ) : null}
          {permissionLabel ? (
            <span className="chat-chip" title={`权限档：${permissionLabel}`}>
              <ShieldIcon />
              <span className="chat-chip__text">{permissionLabel}</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="chat-header__acts">
        <button type="button" className="icon-btn" title="新建会话" onClick={onNewSession}>
          <NewChatIcon />
        </button>
        <button type="button" className="icon-btn" title="设置" onClick={onOpenSettings}>
          <GearIcon />
        </button>
      </div>
    </header>
  );
}
