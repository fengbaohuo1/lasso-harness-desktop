/**
 * 设置 · 模型面板（M6 / P11-7 分层改造）：
 * 渠道 = 连接（baseUrl / 协议 / 密钥），模型 = 规格（上下文窗口 / 最大输出 / 图片输入能力）。
 * 上游表格选渠道，下游表格是该渠道的模型清单；两侧都能增删改。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import type {
  ChannelPreset,
  ModelChannel,
  ModelItem,
  ModelSpecInfo,
  ModelTestResult,
} from '../lib/settings-client';

interface ChannelFormState {
  channelCode: string;
  displayName: string;
  providerCode: string;
  baseUrl: string;
  protocol: string;
  enabled: boolean;
  apiKey: string;
}

interface ModelFormState {
  modelCode: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  imageInput: boolean;
  enabled: boolean;
  isDefault: boolean;
}

const EMPTY_CHANNEL: ChannelFormState = {
  channelCode: '',
  displayName: '',
  providerCode: 'custom',
  baseUrl: '',
  protocol: 'openai',
  enabled: true,
  apiKey: '',
};

const EMPTY_MODEL: ModelFormState = {
  modelCode: '',
  displayName: '',
  contextWindow: 128000,
  maxOutputTokens: 8192,
  imageInput: false,
  enabled: true,
  isDefault: false,
};

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toModelItem(form: ModelFormState): ModelItem {
  return {
    modelCode: form.modelCode.trim(),
    displayName: form.displayName.trim() || form.modelCode.trim(),
    contextWindow: form.contextWindow,
    maxOutputTokens: form.maxOutputTokens,
    inputModalities: form.imageInput ? ['text', 'image'] : ['text'],
    outputModalities: ['text'],
    enabled: form.enabled,
    isDefault: form.isDefault,
  };
}

function toModelForm(model: ModelItem): ModelFormState {
  return {
    modelCode: model.modelCode,
    displayName: model.displayName,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    imageInput: (model.inputModalities ?? []).includes('image'),
    enabled: model.enabled,
    isDefault: model.isDefault,
  };
}

function specToForm(spec: ModelSpecInfo): ModelFormState {
  return {
    modelCode: spec.modelCode,
    displayName: spec.displayName || spec.modelCode,
    contextWindow: spec.contextWindow,
    maxOutputTokens: spec.maxOutputTokens,
    imageInput: (spec.inputModalities ?? []).includes('image'),
    enabled: true,
    isDefault: false,
  };
}

const MEGA = 1024 * 1024;

/**
 * 规格的紧凑显示。
 * <p>厂商文档里的数字有两套约定混用：既写 `128K`（= 128000）也写 `1M / 128K`（= 1048576 / 131072），
 * 所以不能固定用 1000 或 1024 去除——固定 1000 会把 1M 显示成 `1049K`，固定 1024 会把 128000 显示成 `125K`。
 * 做法：算出 1000 与 1024 两个候选，取更接近整数的那个（打平时用 1000，因为 `128K` 更常见）。
 */
function compactNumber(value: number): string {
  if (value >= MEGA) {
    const millions = value / MEGA;
    const rounded = Math.round(millions);
    if (Math.abs(millions - rounded) < 0.05) {
      return `${rounded}M`;
    }
    return `${millions.toFixed(1)}M`;
  }
  if (value < 1000) {
    return String(value);
  }
  const decimal = value / 1000;
  const binary = value / 1024;
  const decimalGap = Math.abs(decimal - Math.round(decimal));
  const binaryGap = Math.abs(binary - Math.round(binary));
  return `${Math.round(binaryGap < decimalGap ? binary : decimal)}K`;
}

export default function ModelSettingsPanel(): ReactElement {
  const [channels, setChannels] = useState<ModelChannel[]>([]);
  const [presets, setPresets] = useState<ChannelPreset[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [channelForm, setChannelForm] = useState<ChannelFormState | null>(null);
  const [modelForm, setModelForm] = useState<ModelFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ModelTestResult | null>(null);
  const [discovered, setDiscovered] = useState<ModelSpecInfo[]>([]);
  /** 发现在列表里勾选的模型编码（批量添加用）。 */
  const [picked, setPicked] = useState<string[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await listModelChannels();
      setChannels(list);
      setError(null);
      setSelected((prev) => {
        if (prev && list.some((c) => c.channelCode === prev)) {
          return prev;
        }
        return list.length > 0 ? list[0].channelCode : null;
      });
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

  const current = useMemo(
    () => channels.find((c) => c.channelCode === selected) ?? null,
    [channels, selected],
  );

  const patchChannel = (patch: Partial<ChannelFormState>): void => {
    setChannelForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const patchModel = (patch: Partial<ModelFormState>): void => {
    setModelForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const applyPreset = (preset: ChannelPreset): void => {
    patchChannel({
      providerCode: preset.providerCode,
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      displayName: preset.displayName,
    });
    if (!modelForm) {
      setModelForm({ ...EMPTY_MODEL, modelCode: preset.recommendedModel });
    } else if (!modelForm.modelCode) {
      patchModel({ modelCode: preset.recommendedModel });
    }
  };

  /** 渠道保存：连同「新建时顺手填的第一个模型」一起提交。 */
  const handleSaveChannel = async (): Promise<void> => {
    if (!channelForm) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const draft = modelForm && modelForm.modelCode.trim() ? toModelItem(modelForm) : null;
      const existing = channels.find((c) => c.channelCode === channelForm.channelCode);
      let models = existing?.models ?? [];
      if (draft) {
        models = [draft, ...models.filter((m) => m.modelCode !== draft.modelCode)];
      }
      await saveModelChannel({
        channelCode: channelForm.channelCode,
        displayName: channelForm.displayName,
        providerCode: channelForm.providerCode,
        modelCode: draft ? draft.modelCode : (existing?.modelCode ?? ''),
        baseUrl: channelForm.baseUrl,
        protocol: channelForm.protocol,
        enabled: channelForm.enabled,
        // apiKey 缺省 = 不修改既有密钥；空串由后端按「清除」处理
        ...(channelForm.apiKey !== '' ? { apiKey: channelForm.apiKey } : {}),
        models,
      });
      setChannelForm(null);
      setModelForm(null);
      setNotice('已保存渠道');
      setSelected(channelForm.channelCode);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  /** P11-3：显式清除密钥（apiKey 传 null 才动密钥库）。 */
  const handleClearApiKey = async (): Promise<void> => {
    if (!channelForm) {
      return;
    }
    setBusy(true);
    try {
      await saveModelChannel({
        channelCode: channelForm.channelCode,
        displayName: channelForm.displayName,
        providerCode: channelForm.providerCode,
        modelCode: current?.modelCode ?? channelForm.channelCode,
        baseUrl: channelForm.baseUrl,
        protocol: channelForm.protocol,
        enabled: channelForm.enabled,
        apiKey: null,
      });
      setNotice(`已清除渠道 ${channelForm.channelCode} 的密钥`);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  /** 模型保存：把整份模型清单回写给渠道（模型是渠道的子资源）。 */
  const persistModels = async (
    channel: ModelChannel,
    models: ModelItem[],
    message: string,
  ): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const fallback = models.find((m) => m.isDefault) ?? models[0];
      await saveModelChannel({
        channelCode: channel.channelCode,
        displayName: channel.displayName,
        providerCode: channel.providerCode,
        modelCode: fallback ? fallback.modelCode : channel.modelCode,
        baseUrl: channel.baseUrl,
        protocol: channel.protocol,
        enabled: channel.enabled,
        models,
      });
      setNotice(message);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveModel = async (): Promise<void> => {
    if (!current || !modelForm) {
      return;
    }
    const item = toModelItem(modelForm);
    if (!item.modelCode) {
      setError('模型编码不能为空');
      return;
    }
    const others = (current.models ?? []).filter((m) => m.modelCode !== item.modelCode);
    const list = item.isDefault
      ? [...others.map((m) => ({ ...m, isDefault: false })), item]
      : [...others, item];
    if (!list.some((m) => m.isDefault) && list.length > 0) {
      list[0] = { ...list[0], isDefault: true };
    }
    setModelForm(null);
    await persistModels(current, list, `已保存模型 ${item.modelCode}`);
  };

  const handleDeleteModel = async (model: ModelItem): Promise<void> => {
    if (!current) {
      return;
    }
    const list = (current.models ?? []).filter((m) => m.modelCode !== model.modelCode);
    if (list.length > 0 && !list.some((m) => m.isDefault)) {
      list[0] = { ...list[0], isDefault: true };
    }
    await persistModels(current, list, `已删除模型 ${model.modelCode}`);
  };

  const handleSetDefaultModel = async (model: ModelItem): Promise<void> => {
    if (!current) {
      return;
    }
    const list = (current.models ?? []).map((m) => ({
      ...m,
      isDefault: m.modelCode === model.modelCode,
    }));
    await persistModels(current, list, `已把 ${model.modelCode} 设为该渠道默认模型`);
  };

  const handleToggleModelEnabled = async (model: ModelItem): Promise<void> => {
    if (!current) {
      return;
    }
    const list = (current.models ?? []).map((m) =>
      m.modelCode === model.modelCode ? { ...m, enabled: !m.enabled } : m,
    );
    await persistModels(current, list, model.enabled ? `已停用 ${model.modelCode}` : `已启用 ${model.modelCode}`);
  };

  const handleTest = async (): Promise<void> => {
    setBusy(true);
    setTestResult(null);
    try {
      const result = await testModelChannel({
        channelCode: channelForm?.channelCode || current?.channelCode,
        modelCode: modelForm?.modelCode || current?.modelCode,
        baseUrl: channelForm?.baseUrl || current?.baseUrl,
        apiKey: channelForm?.apiKey || undefined,
        protocol: channelForm?.protocol || current?.protocol,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, latencyMs: 0, message: describeError(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleDiscover = async (): Promise<void> => {
    setBusy(true);
    try {
      const list = await discoverModels({
        channelCode: channelForm?.channelCode || current?.channelCode,
        baseUrl: channelForm?.baseUrl || current?.baseUrl,
        apiKey: channelForm?.apiKey || undefined,
        protocol: channelForm?.protocol || current?.protocol,
      });
      setDiscovered(list);
      // 默认勾选「还没添加过的对话模型」——用户点「发现模型」多半就是想批量加，逐个勾太累。
      const existing = new Set((current?.models ?? []).map((model) => model.modelCode));
      setPicked(
        list
          .filter((spec) => spec.chatModel !== false && !existing.has(spec.modelCode))
          .map((spec) => spec.modelCode),
      );
      if (list.length === 0) {
        setNotice('上游没有返回可发现的模型');
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const togglePicked = (modelCode: string): void => {
    setPicked((prev) =>
      prev.includes(modelCode) ? prev.filter((code) => code !== modelCode) : [...prev, modelCode],
    );
  };

  /** 发现结果里可勾选的项（已在本渠道下的不可选）。 */
  const pickable = discovered.filter(
    (spec) => !(current?.models ?? []).some((model) => model.modelCode === spec.modelCode),
  );
  const allPicked = pickable.length > 0 && pickable.every((spec) => picked.includes(spec.modelCode));

  /** 批量把勾选的模型挂到当前渠道下（一次请求整份清单回写）。 */
  const handleAddPicked = async (): Promise<void> => {
    if (!current) {
      setError('请先选择或新建一个渠道，再添加模型');
      return;
    }
    const specs = discovered.filter((spec) => picked.includes(spec.modelCode));
    if (specs.length === 0) {
      setError('请先勾选要添加的模型');
      return;
    }
    const existing = current.models ?? [];
    const added = specs
      .filter((spec) => !existing.some((model) => model.modelCode === spec.modelCode))
      .map((spec) => toModelItem(specToForm(spec)));
    if (added.length === 0) {
      setError('勾选的模型都已在当前渠道下');
      return;
    }
    const list = [...existing, ...added];
    if (!list.some((model) => model.isDefault)) {
      list[0] = { ...list[0], isDefault: true };
    }
    await persistModels(
      current,
      list,
      `已添加 ${added.length} 个模型：${added.map((model) => model.modelCode).join('、')}`,
    );
    setPicked([]);
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
      if (selected === channelCode) {
        setSelected(null);
      }
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const closeChannelForm = (): void => {
    setChannelForm(null);
    setModelForm(null);
    setTestResult(null);
    setDiscovered([]);
  };

  const modelCount = (channel: ModelChannel): number => channel.models?.length ?? 0;

  return (
    <div className="settings-panel">
      {error ? (
        <div className="banner banner--error">
          {error}
          <button type="button" className="banner__close" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      ) : null}
      {notice ? <div className="banner banner--info">{notice}</div> : null}

      <div className="settings-toolbar">
        <span className="settings-panel__hint">
          渠道负责连接（baseUrl / 协议 / 密钥），模型负责规格（上下文窗口 / 最大输出 / 图片输入）。
        </span>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setChannelForm({ ...EMPTY_CHANNEL });
            setModelForm({ ...EMPTY_MODEL, isDefault: true });
            setTestResult(null);
            setDiscovered([]);
          }}
        >
          新增渠道
        </button>
      </div>

      <div className="settings-table-wrap settings-table-wrap--models">
        <table className="settings-table">
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '22%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>渠道</th>
              <th>厂商</th>
              <th>协议</th>
              <th>baseUrl</th>
              <th>密钥</th>
              <th>模型</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr
                key={channel.channelCode}
                className={selected === channel.channelCode ? 'settings-table__row--selected' : undefined}
                onClick={() => {
                  setSelected(channel.channelCode);
                  setModelForm(null);
                  setDiscovered([]);
                }}
              >
                <td title={channel.displayName ? `${channel.channelCode} · ${channel.displayName}` : channel.channelCode}>
                  {channel.active ? <span className="status-dot status-dot--ok" title="生效渠道" /> : null}
                  {channel.channelCode}
                  {channel.displayName ? ` · ${channel.displayName}` : ''}
                </td>
                <td>{channel.providerCode}</td>
                <td>{channel.protocol}</td>
                <td className="settings-table__path" title={channel.baseUrl}>
                  {channel.baseUrl}
                </td>
                <td className="settings-table__muted">{channel.hasApiKey ? '已配置' : '未配置'}</td>
                <td className="settings-table__center">{modelCount(channel)}</td>
                <td className="settings-table__actions" onClick={(e) => e.stopPropagation()}>
                  {!channel.active ? (
                    <button
                      type="button"
                      className="btn btn--small"
                      disabled={!channel.enabled}
                      title={channel.enabled ? '设为生效渠道' : '渠道已禁用，先编辑启用'}
                      onClick={() => void handleActivate(channel.channelCode)}
                    >
                      启用
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => {
                      setChannelForm({
                        channelCode: channel.channelCode,
                        displayName: channel.displayName,
                        providerCode: channel.providerCode,
                        baseUrl: channel.baseUrl,
                        protocol: channel.protocol,
                        enabled: channel.enabled,
                        apiKey: '',
                      });
                      setModelForm(null);
                      setTestResult(null);
                      setDiscovered([]);
                      setSelected(channel.channelCode);
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
            {channels.length === 0 ? (
              <tr>
                <td className="settings-empty" colSpan={7}>
                  暂无模型渠道，点击右上角「新增渠道」添加。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {channelForm ? (
        <div className="settings-form">
          <h3>{channelForm.channelCode && channels.some((c) => c.channelCode === channelForm.channelCode)
            ? `编辑渠道 ${channelForm.channelCode}`
            : '新增渠道'}</h3>

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
              value={channelForm.channelCode}
              onChange={(e) => patchChannel({ channelCode: e.target.value })}
              placeholder="如 deepseek-main"
            />
          </label>

          <label className="settings-form__row">
            <span>显示名</span>
            <input value={channelForm.displayName} onChange={(e) => patchChannel({ displayName: e.target.value })} />
          </label>

          <label className="settings-form__row">
            <span>baseUrl *</span>
            <input value={channelForm.baseUrl} onChange={(e) => patchChannel({ baseUrl: e.target.value })} />
          </label>

          <label className="settings-form__row">
            <span>协议</span>
            <select value={channelForm.protocol} onChange={(e) => patchChannel({ protocol: e.target.value })}>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
              <option value="ollama">ollama</option>
            </select>
          </label>

          <label className="settings-form__row">
            <span>API 密钥</span>
            <input
              type="password"
              value={channelForm.apiKey}
              placeholder="留空表示不修改既有密钥"
              onChange={(e) => patchChannel({ apiKey: e.target.value })}
            />
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => void handleClearApiKey()}>
              清除密钥
            </button>
          </label>

          <label className="settings-form__row">
            <span>启用</span>
            <input
              type="checkbox"
              checked={channelForm.enabled}
              onChange={(e) => patchChannel({ enabled: e.target.checked })}
            />
          </label>

          {!channels.some((c) => c.channelCode === channelForm.channelCode) ? (
            <>
              <h3>首个模型（可选）</h3>
              <div className="settings-form__grid">
                <label className="settings-form__row">
                  <span>模型编码</span>
                  <input
                    value={modelForm?.modelCode ?? ''}
                    onChange={(e) => patchModel({ modelCode: e.target.value })}
                    placeholder="如 deepseek-chat"
                  />
                </label>
                <label className="settings-form__row">
                  <span>上下文窗口</span>
                  <input
                    type="number"
                    value={modelForm?.contextWindow ?? 0}
                    onChange={(e) => patchModel({ contextWindow: Number(e.target.value) })}
                  />
                </label>
                <label className="settings-form__row">
                  <span>最大输出</span>
                  <input
                    type="number"
                    value={modelForm?.maxOutputTokens ?? 0}
                    onChange={(e) => patchModel({ maxOutputTokens: Number(e.target.value) })}
                  />
                </label>
                <label className="settings-form__row">
                  <span>支持图片输入</span>
                  <input
                    type="checkbox"
                    checked={modelForm?.imageInput ?? false}
                    onChange={(e) => patchModel({ imageInput: e.target.checked })}
                  />
                </label>
              </div>
            </>
          ) : null}

          <div className="settings-form__actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void handleTest()}>
              测试连接
            </button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleSaveChannel()}>
              保存
            </button>
            <button type="button" className="btn" onClick={closeChannelForm}>
              取消
            </button>
          </div>

          {testResult ? (
            <div className={testResult.ok ? 'banner banner--info' : 'banner banner--error'}>
              {testResult.ok
                ? `连接成功（${testResult.latencyMs}ms，发现模型 ${testResult.models?.length ?? 0} 个）`
                : `连接失败：${testResult.message}`}
            </div>
          ) : null}
        </div>
      ) : null}

      {current ? (
        <div className="model-section">
          <div className="settings-toolbar">
            <h4 className="model-section__title">
              「{current.displayName || current.channelCode}」下的模型
              <span className="model-section__count">{modelCount(current)} 个</span>
            </h4>
            <div className="model-section__acts">
              <button
                type="button"
                className="btn btn--small"
                disabled={busy}
                onClick={() => void handleDiscover()}
              >
                发现模型
              </button>
              <button
                type="button"
                className="btn btn--small btn--primary"
                onClick={() => {
                  setModelForm({
                    ...EMPTY_MODEL,
                    isDefault: modelCount(current) === 0,
                  });
                  setTestResult(null);
                }}
              >
                新增模型
              </button>
            </div>
          </div>

          {discovered.length > 0 ? (
            <div className="discovery">
              <div className="discovery__head">
                <span>
                  上游返回 {discovered.length} 个模型（规格来自内置目录，known 表示已收录）
                </span>
                <div className="discovery__acts">
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={busy || pickable.length === 0}
                    onClick={() => setPicked(allPicked ? [] : pickable.map((spec) => spec.modelCode))}
                  >
                    {allPicked ? '全不选' : '全选'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={busy || picked.length === 0}
                    onClick={() => void handleAddPicked()}
                  >
                    添加选中（{picked.length}）
                  </button>
                  <button type="button" className="btn btn--small" onClick={() => setDiscovered([])}>
                    收起
                  </button>
                </div>
              </div>
              <div className="discovery__list">
                {discovered.map((spec) => {
                  const added = (current?.models ?? []).some((model) => model.modelCode === spec.modelCode);
                  const selected = picked.includes(spec.modelCode);
                  return (
                    <label
                      key={spec.modelCode}
                      className={`discovery__item${selected ? ' discovery__item--on' : ''}${
                        added ? ' discovery__item--added' : ''
                      }`}
                      title={spec.note || undefined}
                    >
                      <input
                        type="checkbox"
                        className="discovery__check"
                        checked={selected}
                        disabled={busy || added}
                        onChange={() => togglePicked(spec.modelCode)}
                      />
                      <span className="discovery__name">{spec.modelCode}</span>
                      <span className="discovery__spec">
                        {spec.chatModel === false
                          ? '非对话模型 · 规格不适用'
                          : `${compactNumber(spec.contextWindow)} 窗口 · ${compactNumber(
                              spec.maxOutputTokens,
                            )} 输出${(spec.inputModalities ?? []).includes('image') ? ' · 图片' : ''}`}
                      </span>
                      {spec.chatModel === false ? <span className="discovery__tag">非对话</span> : null}
                      {spec.chatModel !== false && !spec.known ? (
                        <span className="discovery__tag">推测</span>
                      ) : null}
                      {added ? <span className="discovery__tag discovery__tag--ok">已添加</span> : null}
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {modelForm ? (
            <div className="settings-form">
              <h3>{modelForm.modelCode ? `编辑模型 ${modelForm.modelCode}` : '新增模型'}</h3>
              <div className="settings-form__grid">
                <label className="settings-form__row">
                  <span>模型编码 *</span>
                  <input
                    value={modelForm.modelCode}
                    onChange={(e) => patchModel({ modelCode: e.target.value })}
                    placeholder="如 deepseek-chat"
                  />
                </label>
                <label className="settings-form__row">
                  <span>显示名</span>
                  <input
                    value={modelForm.displayName}
                    onChange={(e) => patchModel({ displayName: e.target.value })}
                    placeholder="默认同模型编码"
                  />
                </label>
                <label className="settings-form__row">
                  <span>上下文窗口</span>
                  <input
                    type="number"
                    value={modelForm.contextWindow}
                    onChange={(e) => patchModel({ contextWindow: Number(e.target.value) })}
                  />
                </label>
                <label className="settings-form__row">
                  <span>最大输出</span>
                  <input
                    type="number"
                    value={modelForm.maxOutputTokens}
                    onChange={(e) => patchModel({ maxOutputTokens: Number(e.target.value) })}
                  />
                </label>
                <label className="settings-form__row">
                  <span>支持图片输入</span>
                  <input
                    type="checkbox"
                    checked={modelForm.imageInput}
                    onChange={(e) => patchModel({ imageInput: e.target.checked })}
                  />
                </label>
                <label className="settings-form__row">
                  <span>启用</span>
                  <input
                    type="checkbox"
                    checked={modelForm.enabled}
                    onChange={(e) => patchModel({ enabled: e.target.checked })}
                  />
                </label>
                <label className="settings-form__row">
                  <span>设为渠道默认</span>
                  <input
                    type="checkbox"
                    checked={modelForm.isDefault}
                    onChange={(e) => patchModel({ isDefault: e.target.checked })}
                  />
                </label>
              </div>
              <div className="settings-form__actions">
                <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleSaveModel()}>
                  保存模型
                </button>
                <button type="button" className="btn" onClick={() => setModelForm(null)}>
                  取消
                </button>
              </div>
            </div>
          ) : null}

          <div className="settings-table-wrap settings-table-wrap--models">
            <table className="settings-table">
              <colgroup>
                <col style={{ width: '26%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '28%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>模型</th>
                  <th>上下文窗口</th>
                  <th>最大输出</th>
                  <th>图片输入</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(current.models ?? []).map((model) => (
                  <tr key={model.modelCode}>
                    <td title={model.modelCode}>
                      {model.modelCode}
                      {model.isDefault ? <span className="badge badge--muted">默认</span> : null}
                    </td>
                    <td className="settings-table__center">{compactNumber(model.contextWindow)}</td>
                    <td className="settings-table__center">{compactNumber(model.maxOutputTokens)}</td>
                    <td className="settings-table__center">
                      {(model.inputModalities ?? []).includes('image') ? '支持' : '—'}
                    </td>
                    <td className="settings-table__center">
                      {model.enabled ? (
                        <span className="status-dot status-dot--on" title="启用" />
                      ) : (
                        <span className="status-dot" title="停用" />
                      )}
                    </td>
                    <td className="settings-table__actions">
                      {!model.isDefault ? (
                        <button
                          type="button"
                          className="btn btn--small"
                          disabled={busy}
                          onClick={() => void handleSetDefaultModel(model)}
                        >
                          设为默认
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn--small"
                        disabled={busy}
                        onClick={() => void handleToggleModelEnabled(model)}
                      >
                        {model.enabled ? '停用' : '启用'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => setModelForm(toModelForm(model))}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="btn btn--small btn--danger"
                        disabled={busy}
                        onClick={() => void handleDeleteModel(model)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
                {(current.models ?? []).length === 0 ? (
                  <tr>
                    <td className="settings-empty" colSpan={6}>
                      该渠道下还没有模型，点「新增模型」或「发现模型」添加。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
