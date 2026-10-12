/**
 * 新会话对话框（P9-7）：智能体预设（类 dsh 模式选择）+ 思考强度 + 工作区，仅新会话时显示。
 * - 预设卡片选中高亮（displayName + description 说明）；预设一经选定绑定整个 session；
 * - 确定 → 生成会话 id → PATCH 会话设置落盘 → 进入会话并聚焦输入框；Esc 取消。
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { WorkspaceIcon } from './icons';
import type { AgentProfile, ReasoningEffort, WorkspaceItem } from '../types';

export interface NewSessionDialogProps {
  profiles: AgentProfile[];
  workspaces: WorkspaceItem[];
  onCancel: () => void;
  /** 确认创建：返回选定的预设码/思考强度/工作区码（null = 跟随默认）。 */
  onConfirm: (presetCode: string | null, reasoningEffort: ReasoningEffort | null, workspaceCode: string | null) => void;
}

const EFFORT_LABEL: Record<string, string> = {
  '': '跟随预设',
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
};

export default function NewSessionDialog({
  profiles,
  workspaces,
  onCancel,
  onConfirm,
}: NewSessionDialogProps): ReactElement {
  const [presetCode, setPresetCode] = useState<string | null>(profiles[0]?.profileCode ?? null);
  const [effort, setEffort] = useState<string>('');
  const [workspaceCode, setWorkspaceCode] = useState<string | null>(workspaces[0]?.workspaceCode ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="settings-overlay new-session-overlay" role="dialog" aria-modal="true" aria-label="新会话">
      <div className="settings-dialog new-session-dialog">
        <div className="settings-dialog__header">
          <h2>新会话</h2>
          <button type="button" className="btn btn--small" onClick={onCancel}>
            取消
          </button>
        </div>
        <div className="settings-dialog__body">
          <div className="new-session-section">
            <div className="new-session-label">智能体预设</div>
            <div className="new-session-presets">
              {profiles.map((profile) => (
                <button
                  key={profile.profileCode}
                  type="button"
                  className={`new-session-preset${presetCode === profile.profileCode ? ' new-session-preset--active' : ''}`}
                  onClick={() => setPresetCode(profile.profileCode)}
                >
                  <span className="new-session-preset__name">
                    {profile.displayName || profile.profileCode}
                    {presetCode === profile.profileCode ? <i className="new-session-preset__current">当前</i> : null}
                  </span>
                  {profile.description ? (
                    <span className="new-session-preset__desc">{profile.description}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
          <div className="new-session-row">
            <div className="new-session-field">
              <label className="new-session-label" htmlFor="new-session-effort">
                思考强度
              </label>
              <select
                id="new-session-effort"
                className="composer__model"
                value={effort}
                onChange={(e) => setEffort(e.target.value)}
              >
                {Object.entries(EFFORT_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="new-session-field">
              <label className="new-session-label" htmlFor="new-session-workspace">
                <WorkspaceIcon /> 工作区
              </label>
              <select
                id="new-session-workspace"
                className="composer__model"
                value={workspaceCode ?? ''}
                onChange={(e) => setWorkspaceCode(e.target.value || null)}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.workspaceCode} value={workspace.workspaceCode}>
                    {workspace.displayName} · {workspace.rootPath}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="new-session-footer">
          <span className="new-session-hint">预设与工作区在整个会话内固定；思考强度可在输入框随时调整</span>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onConfirm(presetCode, (effort || null) as ReasoningEffort | null, workspaceCode)}
          >
            开始
          </button>
        </div>
      </div>
    </div>
  );
}
