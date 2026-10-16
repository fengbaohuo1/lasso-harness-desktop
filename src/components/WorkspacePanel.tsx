/**
 * 设置 · 工作区面板（P9-1 / P10-5）。
 * - 列表只读展示 + 增删改统一走 WorkspaceDialog（带目录浏览），不再内嵌表单；
 * - 删除会解绑该工作区下的会话（后端返回 unboundSessions），避免留下幽灵分组；
 * - 表格固定布局 + colgroup，根路径列 mono 省略，不撑破列。
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactElement } from 'react';
import type { WorkspaceItem } from '../types';
import { confirmAction } from '../lib/confirm';
import { deleteWorkspace, fetchWorkspaces } from '../lib/settings-client';
import { toast } from '../lib/toast';
import WorkspaceDialog from './WorkspaceDialog';

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function WorkspacePanel(): ReactElement {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [dialog, setDialog] = useState<WorkspaceItem | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setWorkspaces(await fetchWorkspaces());
      setError(null);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = async (workspace: WorkspaceItem): Promise<void> => {
    if (workspace.builtin) {
      toast('内置工作区不可删除');
      return;
    }
    const label = workspace.displayName || workspace.workspaceCode;
    const confirmed = await confirmAction({
      title: '删除工作区',
      message: `确认删除工作区「${label}」？\n其下会话会回到默认工作区（不会删除会话）。`,
      confirmLabel: '删除',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      const result = await deleteWorkspace(workspace.workspaceCode);
      const unbound = result.unboundSessions ?? 0;
      toast(
        unbound > 0
          ? `工作区 ${workspace.workspaceCode} 已删除，${unbound} 个会话已解绑`
          : `工作区 ${workspace.workspaceCode} 已删除`,
      );
      await refresh();
    } catch (err) {
      toast(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-panel">
      {error ? <div className="banner banner--error">{error}</div> : null}

      <div className="settings-toolbar">
        <span className="settings-toolbar__hint">
          工作区绑定会话的运行目录（cwd）；沙箱权限按工作区边界判定读写。
        </span>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => setDialog('new')}>
          新建工作区
        </button>
      </div>

      <div className="settings-table-wrap settings-table-wrap--workspaces">
        <table className="settings-table">
          <colgroup>
            <col style={{ width: '24%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '36%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>名称</th>
              <th>编码</th>
              <th>根路径</th>
              <th>类型</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((workspace) => (
              <tr key={workspace.workspaceCode}>
                <td>{workspace.displayName || workspace.workspaceCode}</td>
                <td className="settings-table__mono">{workspace.workspaceCode}</td>
                <td className="settings-table__path" title={workspace.rootPath}>
                  {workspace.rootPath}
                </td>
                <td>
                  {workspace.builtin ? (
                    <span className="badge badge--muted" title="内置工作区，不可删除">
                      内置
                    </span>
                  ) : (
                    <span className="settings-table__muted">自定义</span>
                  )}
                </td>
                <td className="settings-table__actions">
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={busy}
                    onClick={() => setDialog(workspace)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn--danger"
                    disabled={busy || workspace.builtin}
                    title={workspace.builtin ? '内置工作区不可删除' : '删除工作区'}
                    onClick={() => void handleDelete(workspace)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {workspaces.length === 0 ? (
              <tr>
                <td className="settings-empty" colSpan={5}>
                  暂无自定义工作区，点击右上角「新建工作区」添加。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {dialog
        ? createPortal(
            <WorkspaceDialog
              target={dialog === 'new' ? null : dialog}
              onClose={() => setDialog(null)}
              onSaved={() => {
                setDialog(null);
                void refresh();
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
