/**
 * 设置 · 模型渠道面板（M6）：
 * 渠道列表（生效徽标/密钥状态）+ 新增/编辑表单（预设快捷填充、模型发现、测试连接、写入式密钥）。
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  activateModelChannel,
  deleteModelChannel,
  discoverModels,
  fetchChannelPresets,
  listModelChannels,
  saveModelChannel,
  testModelChannel,
} from '../lib/settings-client';
import type { ChannelPreset, ModelChannel, ModelTestResult } from '../lib/settings-client';

interface FormState {
  channelCode: string;
  displayName: string;
  providerCode: string;
  modelCode: string;
  baseUrl: string;
  protocol: string;
  enabled: boolean;
  apiKey: string;
}

const EMPTY_FORM: FormState = {
  channelCode: '',
  displayName: '',
  providerCode: 'custom',
  modelCode: '',
  baseUrl: '',
  protocol: 'openai',
  enabled: true,
  apiKey: '',
};

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function ModelSettingsPanel(): ReactElement {
  const [channels, setChannels] = useState<ModelChannel[]>([]);
  const [presets, setPresets] = useState<ChannelPreset[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ModelTestResult | null>(null);
  const [discovered, setDiscovered] = useState<string[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setChannels(await listModelChannels());
      setError(null);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    void fetchChannelPresets()
      .then(setPresets)
      .catch(() => setPresets([]));
  }, [refresh]);

  const patchForm = (patch: Partial<FormState>): void => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const applyPreset = (preset: ChannelPreset): void => {
    patchForm({
      providerCode: preset.providerCode,
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      modelCode: preset.recommendedModel,
      displayName: preset.displayName,
    });
  };

  const handleSave = async (): Promise<void> => {
    if (!form) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await saveModelChannel({
        channelCode: form.channelCode,
        displayName: form.displayName,
        providerCode: form.providerCode,
        modelCode: form.modelCode,
        baseUrl: form.baseUrl,
        protocol: form.protocol,
        enabled: form.enabled,
        apiKey: form.apiKey || undefined,
      });
      setForm(null);
      setNotice('已保存');
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    if (!form) {
      return;
    }
    setBusy(true);
    setTestResult(null);
    try {
      const result = await testModelChannel({
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined,
        protocol: form.protocol,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, latencyMs: 0, message: describeError(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleDiscover = async (): Promise<void> => {
    if (!form) {
      return;
    }
    setBusy(true);
    try {
      setDiscovered(
        await discoverModels({
          baseUrl: form.baseUrl,
          apiKey: form.apiKey || undefined,
          protocol: form.protocol,
        }),
      );
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleActivate = async (channelCode: string): Promise<void> => {
    try {
      await activateModelChannel(channelCode);
      setNotice(`已启用渠道 ${channelCode}（对下一条消息即生效）`);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const handleDelete = async (channelCode: string): Promise<void> => {
    try {
      await deleteModelChannel(channelCode);
      setNotice(`已删除渠道 ${channelCode}`);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <div className="settings-panel">
      {error ? <div className="banner banner--error">{error}</div> : null}
      {notice ? <div className="banner banner--info">{notice}</div> : null}

      <div className="settings-toolbar">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setForm({ ...EMPTY_FORM });
            setTestResult(null);
            setDiscovered([]);
          }}
        >
          新增渠道
        </button>
      </div>

      <table className="settings-table">
        <thead>
          <tr>
            <th>渠道</th>
            <th>厂商</th>
            <th>模型</th>
            <th>协议</th>
            <th>baseUrl</th>
            <th>密钥</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) => (
            <tr key={channel.channelCode}>
              <td>
                {channel.channelCode}
                {channel.displayName ? ` · ${channel.displayName}` : ''}
              </td>
              <td>{channel.providerCode}</td>
              <td>{channel.modelCode}</td>
              <td>{channel.protocol}</td>
              <td className="settings-table__path">{channel.baseUrl}</td>
              <td>{channel.hasApiKey ? '已配置' : '未配置'}</td>
              <td>
                {channel.active ? (
                  <span className="status-dot status-dot--ok" title="生效中" />
                ) : channel.enabled ? (
                  <span className="status-dot status-dot--on" title="启用（非生效渠道）" />
                ) : (
                  <span className="status-dot" title="禁用" />
                )}
              </td>
              <td className="settings-table__actions">
                {!channel.active ? (
                  <button type="button" className="btn btn--small" onClick={() => void handleActivate(channel.channelCode)}>
                    启用
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => {
                    setForm({
                      channelCode: channel.channelCode,
                      displayName: channel.displayName,
                      providerCode: channel.providerCode,
                      modelCode: channel.modelCode,
                      baseUrl: channel.baseUrl,
                      protocol: channel.protocol,
                      enabled: channel.enabled,
                      apiKey: '',
                    });
                    setTestResult(null);
                    setDiscovered([]);
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  onClick={() => void handleDelete(channel.channelCode)}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {form ? (
        <div className="settings-form">
          <h3>{form.channelCode ? `编辑渠道 ${form.channelCode}` : '新增渠道'}</h3>

          <label className="settings-form__row">
            <span>快捷填充</span>
            <select
              defaultValue=""
              onChange={(e) => {
                const preset = presets.find((p) => p.providerCode === e.target.value);
                if (preset) {
                  applyPreset(preset);
                }
              }}
            >
              <option value="">选择厂商预设…</option>
              {presets.map((preset) => (
                <option key={preset.providerCode} value={preset.providerCode}>
                  {preset.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-form__row">
            <span>渠道码 *</span>
            <input
              value={form.channelCode}
              onChange={(e) => patchForm({ channelCode: e.target.value })}
              placeholder="如 deepseek-main"
            />
          </label>

          <label className="settings-form__row">
            <span>显示名</span>
            <input value={form.displayName} onChange={(e) => patchForm({ displayName: e.target.value })} />
          </label>

          <label className="settings-form__row">
            <span>baseUrl *</span>
            <input value={form.baseUrl} onChange={(e) => patchForm({ baseUrl: e.target.value })} />
          </label>

          <label className="settings-form__row">
            <span>协议</span>
            <select value={form.protocol} onChange={(e) => patchForm({ protocol: e.target.value })}>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
              <option value="ollama">ollama</option>
            </select>
          </label>

          <label className="settings-form__row">
            <span>模型 *</span>
            <input value={form.modelCode} onChange={(e) => patchForm({ modelCode: e.target.value })} />
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => void handleDiscover()}>
              发现模型
            </button>
          </label>
          {discovered.length > 0 ? (
            <label className="settings-form__row">
              <span>发现结果</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    patchForm({ modelCode: e.target.value });
                  }
                }}
              >
                <option value="">选择模型填入…</option>
                {discovered.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="settings-form__row">
            <span>API 密钥</span>
            <input
              type="password"
              value={form.apiKey}
              placeholder="留空表示不修改既有密钥"
              onChange={(e) => patchForm({ apiKey: e.target.value })}
            />
          </label>

          <label className="settings-form__row">
            <span>启用</span>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => patchForm({ enabled: e.target.checked })}
            />
          </label>

          <div className="settings-form__actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void handleTest()}>
              测试连接
            </button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleSave()}>
              保存
            </button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              取消
            </button>
          </div>

          {testResult ? (
            <div className={testResult.ok ? 'banner banner--info' : 'banner banner--error'}>
              {testResult.ok
                ? `连接成功（${testResult.latencyMs}ms，模型 ${testResult.models?.length ?? 0} 个）`
                : `连接失败：${testResult.message}`}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
