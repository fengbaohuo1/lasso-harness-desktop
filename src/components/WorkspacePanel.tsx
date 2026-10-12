/**
 * 设置 · 工作区面板（P9-1）：工作区列表 + 新建/编辑/删除。
 * - 会话经工作区绑定 cwd；内置工作区（builtin）禁删（title 说明；后端 40000 兜底）；
 * - 表格列 nowrap + ellipsis（styles.css 全局规则），根路径用 mono。
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { WorkspaceItem } from '../types';
import {
  createWorkspace,
  deleteWorkspace,
  fetchWorkspaces,
  updateWorkspace,
} from '../lib/settings-client';
import { toast } from '../lib/toast';

interface FormState {
  workspaceCode: string;
  isNew: boolean;
  displayName: string;
  rootPath: string;
}

function toForm(workspace: WorkspaceItem): FormState {
  return {
    workspaceCode: workspace.workspaceCode,
    isNew: false,
    displayName: workspace.displayName ?? '',
    rootPath: workspace.rootPath ?? '',
  };
}

function emptyForm(): FormState {
  return { workspaceCode: '', isNew: true, displayName: '', rootPath: '' };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function WorkspacePanel(): ReactElement {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
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

  const patchForm = (patch: Partial<FormState>): void => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleSave = async (): Promise<void> => {
    if (!form || busy) {
      return;
    }
    const displayName = form.displayName.trim();
    const rootPath = form.rootPath.trim();
    if (!displayName) {
      toast('工作区名称不能为空');
      return;
    }
    if (!rootPath) {
      toast('根路径不能为空');
      return;
    }
    setBusy(true);
    try {
      if (form.isNew) {
        await createWorkspace({ displayName, rootPath });
        toast(`工作区「${displayName}」已创建`);
      } else {
        await updateWorkspace(form.workspaceCode, { displayName, rootPath });
        toast(`工作区「${displayName}」已保存`);
      }
      setForm(null);
      await refresh();
    } catch (err) {
      toast(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (workspace: WorkspaceItem): Promise<void> => {
    if (workspace.builtin) {
      toast('内置工作区不可删除');
      return;
    }
    if (!window.confirm(`确认删除工作区「${workspace.displayName || workspace.workspaceCode}」？`)) {
      return;
    }
    setBusy(true);
    try {
      await deleteWorkspace(workspace.workspaceCode);
      toast(`工作区 ${workspace.workspaceCode} 已删除`);
      if (form?.workspaceCode === workspace.workspaceCode) {
        setForm(null);
      }
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
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => setForm(emptyForm())}
        >
          新建工作区
        </button>
      </div>

      <table className="settings-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>编码</th>
            <th>根路径</th>
            <th>类型</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {workspaces.map((workspace) => (
            <tr key={workspace.workspaceCode}>
              <td>{workspace.displayName || workspace.workspaceCode}</td>
              <td>{workspace.workspaceCode}</td>
              <td className="settings-table__path" title={workspace.rootPath}>
                {workspace.rootPath}
              </td>
              <td>
                {workspace.builtin ? (
                  <span className="badge badge--muted" title="内置工作区，不可删除">
                    内置
                  </span>
                ) : (
                  '自定义'
                )}
              </td>
              <td className="settings-table__actions">
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => setForm(toForm(workspace))}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  disabled={busy}
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
              <td colSpan={5}>加载中或暂无工作区…</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {form ? (
        <div className="settings-form">
          <h3>{form.isNew ? '新建工作区' : `编辑工作区 ${form.workspaceCode}`}</h3>

          <label className="settings-form__row">
            <span>名称 *</span>
            <input
              value={form.displayName}
              disabled={busy}
              placeholder="如 项目A、文档区"
              onChange={(e) => patchForm({ displayName: e.target.value })}
            />
          </label>

          <label className="settings-form__row">
            <span>根路径 *</span>
            <input
              value={form.rootPath}
              disabled={busy}
              placeholder="如 D:\study\dsh-java"
              onChange={(e) => patchForm({ rootPath: e.target.value })}
            />
          </label>

          <div className="settings-form__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void handleSave()}
            >
              保存
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setForm(null)}>
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
