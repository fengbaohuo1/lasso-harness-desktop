/**
 * 设置 · 插件管理面板（P4）：
 * 已安装（启用/停用/重载/卸载/配置）+ 可安装目录（catalog 一键安装）+ 配置 KV 编辑。
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  activatePlugin,
  deletePluginConfigKey,
  disablePlugin,
  fetchPluginCatalog,
  getPluginConfig,
  installPlugin,
  listPlugins,
  reloadPlugin,
  savePluginConfig,
  uninstallPlugin,
} from '../lib/settings-client';
import type { PluginCatalogItem, PluginItem } from '../lib/settings-client';

interface ConfigRow {
  key: string;
  value: string;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function PluginConfigEditor({
  pluginId,
  onClose,
}: {
  pluginId: string;
  onClose: () => void;
}): ReactElement {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void getPluginConfig(pluginId)
      .then((config) => setRows(Object.entries(config).map(([key, value]) => ({ key, value }))))
      .catch((err) => setError(describeError(err)));
  }, [pluginId]);

  const handleSave = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const config: Record<string, string> = {};
      for (const row of rows) {
        if (row.key.trim() !== '') {
          config[row.key.trim()] = row.value;
        }
      }
      await savePluginConfig(pluginId, config);
      setNotice('配置已保存（持久化）');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRow = async (key: string): Promise<void> => {
    setRows((prev) => prev.filter((row) => row.key !== key));
    if (key.trim() !== '') {
      try {
        await deletePluginConfigKey(pluginId, key.trim());
      } catch (err) {
        setError(describeError(err));
      }
    }
  };

  return (
    <div className="settings-form">
      <h3>
        配置 · {pluginId}
        <button type="button" className="btn btn--small" onClick={onClose}>
          收起
        </button>
      </h3>
      {error ? <div className="banner banner--error">{error}</div> : null}
      {notice ? <div className="banner banner--info">{notice}</div> : null}
      <table className="settings-table">
        <thead>
          <tr>
            <th>键</th>
            <th>值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.key}-${index}`}>
              <td>
                <input
                  value={row.key}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)),
                    )
                  }
                />
              </td>
              <td>
                <input
                  value={row.value}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)),
                    )
                  }
                />
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  onClick={() => void handleDeleteRow(row.key)}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="settings-form__actions">
        <button
          type="button"
          className="btn btn--small"
          onClick={() => setRows((prev) => [...prev, { key: '', value: '' }])}
        >
          加一行
        </button>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleSave()}>
          保存配置
        </button>
      </div>
    </div>
  );
}

export default function PluginSettingsPanel(): ReactElement {
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [catalog, setCatalog] = useState<PluginCatalogItem[]>([]);
  const [configFor, setConfigFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setPlugins(await listPlugins());
      setCatalog(await fetchPluginCatalog());
      setError(null);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = (action: () => Promise<unknown>, okMessage: string): void => {
    setBusy(true);
    setError(null);
    void action()
      .then(() => setNotice(okMessage))
      .catch((err) => setError(describeError(err)))
      .finally(() => {
        setBusy(false);
        void refresh();
      });
  };

  return (
    <div className="settings-panel">
      {error ? <div className="banner banner--error">{error}</div> : null}
      {notice ? <div className="banner banner--info">{notice}</div> : null}

      <h3>已安装</h3>
      <table className="settings-table">
        <thead>
          <tr>
            <th>插件</th>
            <th>版本</th>
            <th>运行时</th>
            <th>状态</th>
            <th>运行态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {plugins.map((plugin) => (
            <tr key={plugin.pluginId}>
              <td>
                {plugin.pluginId}
                {plugin.displayName && plugin.displayName !== plugin.pluginId
                  ? ` · ${plugin.displayName}`
                  : ''}
              </td>
              <td>{plugin.pluginVersion}</td>
              <td>{plugin.runtimeType}</td>
              <td>
                <span
                  className={
                    plugin.status === 'ACTIVE'
                      ? 'badge badge--active'
                      : plugin.status === 'FAILED'
                        ? 'badge badge--danger'
                        : 'badge badge--muted'
                  }
                >
                  {plugin.status}
                </span>
              </td>
              <td>{plugin.runtimeState}</td>
              <td className="settings-table__actions">
                {plugin.status !== 'ACTIVE' ? (
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={busy}
                    onClick={() => run(() => activatePlugin(plugin.pluginId), `已启用 ${plugin.pluginId}`)}
                  >
                    启用
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={busy}
                    onClick={() => run(() => disablePlugin(plugin.pluginId), `已停用 ${plugin.pluginId}`)}
                  >
                    停用
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => run(() => reloadPlugin(plugin.pluginId), `已重载 ${plugin.pluginId}`)}
                >
                  重载
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => setConfigFor(configFor === plugin.pluginId ? null : plugin.pluginId)}
                >
                  配置
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  disabled={busy}
                  onClick={() => run(() => uninstallPlugin(plugin.pluginId), `已卸载 ${plugin.pluginId}`)}
                >
                  卸载
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {configFor ? <PluginConfigEditor pluginId={configFor} onClose={() => setConfigFor(null)} /> : null}

      <h3>可安装（插件目录）</h3>
      <table className="settings-table">
        <thead>
          <tr>
            <th>插件</th>
            <th>版本</th>
            <th>运行时</th>
            <th>说明</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {catalog.map((item) => (
            <tr key={`${item.pluginId}-${item.sourcePath}`}>
              <td>{item.pluginId}</td>
              <td>{item.version}</td>
              <td>{item.runtimeType}</td>
              <td className="settings-table__path">{item.description || item.sourcePath}</td>
              <td>{item.installed ? <span className="badge badge--active">已安装</span> : '—'}</td>
              <td>
                {item.installed ? null : (
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          installPlugin({
                            pluginId: item.pluginId,
                            displayName: item.displayName,
                            pluginVersion: item.version,
                            runtimeType: item.runtimeType,
                            sourcePath: item.sourcePath,
                            entrypoint: item.entrypoint,
                          }),
                        `已安装 ${item.pluginId}`,
                      )
                    }
                  >
                    安装
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
