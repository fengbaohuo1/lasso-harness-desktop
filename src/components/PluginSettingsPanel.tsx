/**
 * 设置 · 插件管理面板（P4 + U3）：
 * 已安装（启用/停用/重载/卸载/配置）+ 可安装目录（catalog 一键安装）。
 * U3：点「配置」进入该插件**独立配置页**（PluginConfigPage：settingsPage 表单 / KV 回退）；
 * hasUi 徽标 + 「重载插件 UI」（reloadPluginUi 免重启重拉清单）；
 * reload/enable/disable 成功后自动刷新 UI 清单（SD5）。
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  activatePlugin,
  disablePlugin,
  fetchPluginCatalog,
  installPlugin,
  listPlugins,
  reloadPlugin,
  uninstallPlugin,
} from '../lib/settings-client';
import type { PluginCatalogItem, PluginItem } from '../lib/settings-client';
import { fetchPluginContributions } from '../lib/console-client';
import type { PluginContributions } from '../types';
import { loadPluginUi, reloadPluginUi, usePluginUiMap } from '../lib/plugin-ui';
import { toast } from '../lib/toast';
import PluginConfigPage from './PluginConfigPage';

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function PluginSettingsPanel(): ReactElement {
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [catalog, setCatalog] = useState<PluginCatalogItem[]>([]);
  const [configFor, setConfigFor] = useState<PluginItem | null>(null);
  const [contributions, setContributions] = useState<
    { pluginId: string; data: PluginContributions } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const uiMap = usePluginUiMap();

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
    void loadPluginUi().catch(() => undefined);
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
        // 启停/重载可能改变前端贡献面 → 自动刷新 UI 清单（SD5）
        void loadPluginUi(true).catch(() => undefined);
      });
  };

  const handleReloadUi = (): void => {
    setBusy(true);
    void reloadPluginUi()
      .then(() => toast('插件 UI 清单已重载', 'success'))
      .catch((err) => toast(`重载失败：${describeError(err)}`, 'error'))
      .finally(() => setBusy(false));
  };

  /** P8-2：展开/收起插件贡献详情（工具/端点/命令/提及源/配置页）。 */
  const toggleContributions = (pluginId: string): void => {
    if (contributions?.pluginId === pluginId) {
      setContributions(null);
      return;
    }
    setContributions({ pluginId, data: { pluginId, runtimeState: '', tools: [], endpoints: [], slashCommands: [], mentionProviders: [], hasSettingsPage: false } });
    void fetchPluginContributions(pluginId)
      .then((data) => setContributions({ pluginId, data }))
      .catch((err) => {
        setContributions(null);
        toast(`贡献面拉取失败：${describeError(err)}`, 'error');
      });
  };

  // U3：独立配置页视图（返回按钮回列表）
  if (configFor) {
    return (
      <div className="settings-panel">
        <PluginConfigPage
          plugin={configFor}
          manifest={uiMap.get(configFor.pluginId) ?? null}
          onBack={() => {
            setConfigFor(null);
            void refresh();
          }}
          onSaved={() => void refresh()}
        />
      </div>
    );
  }

  return (
    <div className="settings-panel">
      {error ? <div className="banner banner--error">{error}</div> : null}
      {notice ? <div className="banner banner--info">{notice}</div> : null}

      <div className="settings-panel__toolbar">
        <h3>已安装</h3>
        <button
          type="button"
          className="btn btn--small"
          disabled={busy}
          title="重新拉取插件 UI 贡献清单（免重启）"
          onClick={handleReloadUi}
        >
          重载插件 UI
        </button>
      </div>
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
            <Fragment key={plugin.pluginId}>
              <tr>
                <td>
                  {plugin.pluginId}
                  {plugin.displayName && plugin.displayName !== plugin.pluginId
                    ? ` · ${plugin.displayName}`
                    : ''}
                  {plugin.hasUi ? (
                    <span className="badge badge--active settings-table__ui-badge" title="声明了 UI 贡献清单（工具卡渲染/配置页面）">
                      UI
                    </span>
                  ) : null}
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
                    title="查看该插件注册的工具/端点/命令/提及源（P8-2）"
                    onClick={() => void toggleContributions(plugin.pluginId)}
                  >
                    {contributions?.pluginId === plugin.pluginId ? '收起' : '贡献'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--small"
                    title="打开该插件的独立配置页面"
                    onClick={() => setConfigFor(plugin)}
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
              {contributions?.pluginId === plugin.pluginId ? (
                <tr>
                  <td colSpan={6}>
                    <div className="plugin-contrib">
                      <div>
                        <b>工具</b>
                        {contributions.data.tools.length === 0 ? '：无' : null}
                        {contributions.data.tools.map((tool) => (
                          <span key={tool.name} className="plugin-contrib__chip" title={tool.description ?? ''}>
                            {tool.name}
                          </span>
                        ))}
                      </div>
                      <div>
                        <b>REST 端点</b>
                        {contributions.data.endpoints.length === 0 ? '：无' : null}
                        {contributions.data.endpoints.map((endpoint) => (
                          <span key={`${endpoint.method} ${endpoint.path}`} className="plugin-contrib__chip">
                            {endpoint.method} {endpoint.path}
                          </span>
                        ))}
                      </div>
                      <div>
                        <b>命令（skill）</b>
                        {contributions.data.slashCommands.length === 0 ? '：无' : null}
                        {contributions.data.slashCommands.map((command) => (
                          <span key={command.name} className="plugin-contrib__chip" title={command.description ?? ''}>
                            /{command.name}
                          </span>
                        ))}
                      </div>
                      <div>
                        <b>@ 提及源</b>
                        {contributions.data.mentionProviders.length === 0 ? '：无' : null}
                        {contributions.data.mentionProviders.map((provider) => (
                          <span key={provider.id} className="plugin-contrib__chip">
                            {provider.label ?? provider.id}（{provider.endpoint}
                            {provider.readEndpoint ? ` / ${provider.readEndpoint}` : ''}）
                          </span>
                        ))}
                      </div>
                      <div>
                        <b>配置页</b>：
                        {contributions.data.hasSettingsPage
                          ? contributions.data.settingsPageTitle || '独立配置页面'
                          : 'KV 编辑器'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>

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
