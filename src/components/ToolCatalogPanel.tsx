/**
 * P8-2 工具注册管理：工具目录表（toolCode/名称/描述/分类/审批）+ 工具画像绑定管理
 * （勾选 = 该 toolProfile 白名单；整体替换 PUT /tool-catalog/profiles/{code}）。
 * 数据源：GET /api/harness/tool-catalog（全量目录）+ GET/PUT /tool-catalog/profiles/{code}。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  fetchToolCatalog,
  fetchToolProfileBindings,
  replaceToolProfileBindings,
} from '../lib/console-client';
import { listProfiles } from '../lib/settings-client';
import type { ToolCatalogItem } from '../lib/commands';
import { toast } from '../lib/toast';

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function ToolCatalogPanel(): ReactElement {
  const [tools, setTools] = useState<ToolCatalogItem[]>([]);
  const [profiles, setProfiles] = useState<string[]>(['default']);
  const [selected, setSelected] = useState('default');
  const [bound, setBound] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 工具画像码池：default + 各智能体画像引用的 toolProfile
  useEffect(() => {
    void listProfiles()
      .then((list) => {
        const codes = new Set<string>(['default']);
        for (const profile of list) {
          if (profile.toolProfile) {
            codes.add(profile.toolProfile);
          }
        }
        setProfiles([...codes]);
      })
      .catch(() => undefined);
  }, []);

  const refresh = useCallback(async (profileCode: string) => {
    try {
      const [all, enabled] = await Promise.all([
        fetchToolCatalog(),
        fetchToolProfileBindings(profileCode),
      ]);
      setTools(all);
      setBound(new Set(enabled.map((item) => item.toolCode)));
      setError(null);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    void refresh(selected);
  }, [selected, refresh]);

  const toggle = (toolCode: string): void => {
    setBound((prev) => {
      const next = new Set(prev);
      if (next.has(toolCode)) {
        next.delete(toolCode);
      } else {
        next.add(toolCode);
      }
      return next;
    });
  };

  const save = (): void => {
    setBusy(true);
    void replaceToolProfileBindings(selected, [...bound])
      .then(() => {
        toast(`已保存 ${selected} 的工具绑定（${bound.size} 个）`, 'success');
        return refresh(selected);
      })
      .catch((err) => toast(describeError(err)))
      .finally(() => setBusy(false));
  };

  const sorted = useMemo(
    () => [...tools].sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.toolCode.localeCompare(b.toolCode)),
    [tools],
  );

  return (
    <div className="settings-panel">
      {error ? <div className="banner banner--error">{error}</div> : null}
      <div className="settings-panel__toolbar">
        <h3>工具注册目录（{tools.length}）</h3>
        <div className="settings-panel__toolbar-actions">
          <select
            className="composer__model"
            value={selected}
            aria-label="选择工具画像"
            title="工具画像：画像的 toolProfile 引用它作为工具白名单（R5）"
            onChange={(e) => setSelected(e.target.value)}
          >
            {profiles.map((code) => (
              <option key={code} value={code}>
                工具画像 · {code}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--small" disabled={busy} onClick={save}>
            保存绑定（{bound.size}）
          </button>
        </div>
      </div>
      <p className="settings-panel__hint">
        勾选 = 允许该工具画像下的智能体使用此工具；模型可见工具面按此白名单现算（token 开销可控）。
      </p>
      <div className="settings-table-wrap settings-table-wrap--tools">
        <table className="settings-table">
          <colgroup>
            <col style={{ width: '6%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '30%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>启用</th>
              <th>工具</th>
              <th>名称</th>
              <th>描述</th>
              <th>分类</th>
              <th>审批</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((tool) => (
              <tr key={tool.toolCode}>
                <td className="settings-table__center">
                  <input
                    type="checkbox"
                    checked={bound.has(tool.toolCode)}
                    aria-label={`绑定 ${tool.toolCode}`}
                    onChange={() => toggle(tool.toolCode)}
                  />
                </td>
                <td className="settings-table__mono" title={tool.toolCode}>
                  {tool.toolCode}
                </td>
                <td>{tool.displayName || '—'}</td>
                <td className="settings-table__desc" title={tool.description || ''}>
                  {tool.description || '—'}
                </td>
                <td>{tool.category || '—'}</td>
                <td>
                  {tool.requiresApproval ? (
                    <span className="badge badge--warn">需审批</span>
                  ) : (
                    <span className="settings-table__muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td className="settings-empty" colSpan={6}>
                  暂无工具注册信息。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
