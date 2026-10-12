/**
 * 智能体预设管理（A4 + P9-7，原「画像」）：预设列表 + 新建/编辑表单
 * （描述/模型偏好/思考强度/步数/预算/工具画像/提示词补丁）+ 删除保护。
 * - 保存走 PUT /api/harness/profiles/{code}（部分字段 upsert，缺省沿用原值），成功/失败 toast；
 * - `default` 预设禁删（后端 40000，前端提前拦截提示）；
 * - toolProfile 是工具目录画像码（R5 白名单）——文本输入 + 说明；
 * - 数值字段空值按后端缺省回落；maxTokens / temperature / modelCode / reasoningEffort 可空（跟随默认）。
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { AgentProfile, AgentProfileInput, ReasoningEffort } from '../types';
import {
  deleteProfile,
  listModelChannels,
  listProfiles,
  saveProfile,
} from '../lib/settings-client';
import { toast } from '../lib/toast';

const DEFAULT_PROFILE_CODE = 'default';
const MAX_PROMPT_EXTRA = 4000;
const MAX_DESCRIPTION = 500;

/** 思考强度选项（'' = 跟随模型默认 → null）。 */
const REASONING_EFFORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '默认（跟随模型）' },
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

interface FormState {
  /** 新建时可编辑；编辑既有预设时锁定。 */
  profileCode: string;
  isNew: boolean;
  displayName: string;
  description: string;
  modelCode: string;
  reasoningEffort: string;
  maxStepsPerTurn: string;
  maxTokenContinuations: string;
  contextTokenBudget: string;
  keepRecentMessages: string;
  compactionThresholdTokens: string;
  maxTokens: string;
  temperature: string;
  toolProfile: string;
  promptExtra: string;
}

function toForm(profile: AgentProfile): FormState {
  return {
    profileCode: profile.profileCode,
    isNew: false,
    displayName: profile.displayName ?? '',
    description: profile.description ?? '',
    modelCode: profile.modelCode ?? '',
    reasoningEffort: profile.reasoningEffort ?? '',
    maxStepsPerTurn: String(profile.maxStepsPerTurn ?? ''),
    maxTokenContinuations: String(profile.maxTokenContinuations ?? ''),
    contextTokenBudget: String(profile.contextTokenBudget ?? ''),
    keepRecentMessages: String(profile.keepRecentMessages ?? ''),
    compactionThresholdTokens: String(profile.compactionThresholdTokens ?? ''),
    maxTokens: profile.maxTokens == null ? '' : String(profile.maxTokens),
    temperature: profile.temperature == null ? '' : String(profile.temperature),
    toolProfile: profile.toolProfile ?? '',
    promptExtra: profile.promptExtra ?? '',
  };
}

function emptyForm(): FormState {
  return {
    profileCode: '',
    isNew: true,
    displayName: '',
    description: '',
    modelCode: '',
    reasoningEffort: '',
    maxStepsPerTurn: '50',
    maxTokenContinuations: '4',
    contextTokenBudget: '128000',
    keepRecentMessages: '6',
    compactionThresholdTokens: '100000',
    maxTokens: '',
    temperature: '',
    toolProfile: 'default',
    promptExtra: '',
  };
}

/** 数字字段解析：空 → undefined（不改）；非法 → null（调用方拒绝保存）。 */
function parseNumberField(value: string, integer: boolean): number | undefined | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < 0) {
    return null;
  }
  return parsed;
}

export default function ProfileSettingsPanel(): ReactElement {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [modelCodes, setModelCodes] = useState<string[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProfiles(await listProfiles());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // 模型偏好下拉：已配置模型渠道的 modelCode（去重）
  const refreshModels = useCallback(async () => {
    try {
      const channels = await listModelChannels();
      setModelCodes([...new Set(channels.map((c) => c.modelCode).filter(Boolean))]);
    } catch {
      setModelCodes([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshModels();
  }, [refresh, refreshModels]);

  const patchForm = (patch: Partial<FormState>): void => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleSave = async (): Promise<void> => {
    if (!form || busy) {
      return;
    }
    const code = form.profileCode.trim();
    if (!code) {
      toast('预设编码不能为空');
      return;
    }
    if (form.description.length > MAX_DESCRIPTION) {
      toast(`说明最长 ${MAX_DESCRIPTION} 字`);
      return;
    }
    if (form.promptExtra.length > MAX_PROMPT_EXTRA) {
      toast(`提示词补丁最长 ${MAX_PROMPT_EXTRA} 字`);
      return;
    }
    const steps = parseNumberField(form.maxStepsPerTurn, true);
    const continuations = parseNumberField(form.maxTokenContinuations, true);
    const budget = parseNumberField(form.contextTokenBudget, true);
    const keep = parseNumberField(form.keepRecentMessages, true);
    const compaction = parseNumberField(form.compactionThresholdTokens, true);
    const maxTokens = parseNumberField(form.maxTokens, true);
    const temperatureRaw = form.temperature.trim();
    let temperature: number | undefined;
    if (temperatureRaw !== '') {
      const parsed = Number(temperatureRaw);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
        toast('temperature 需为 0~2 的数字');
        return;
      }
      temperature = parsed;
    }
    if (
      steps === null ||
      continuations === null ||
      budget === null ||
      keep === null ||
      compaction === null ||
      maxTokens === null
    ) {
      toast('数值字段需为非负整数（可留空）');
      return;
    }
    const reasoningEffort = (form.reasoningEffort || null) as ReasoningEffort | null;

    const input: AgentProfileInput = {
      displayName: form.displayName.trim(),
      description: form.description.trim(),
      modelCode: form.modelCode.trim() || null,
      reasoningEffort,
      maxStepsPerTurn: steps,
      maxTokenContinuations: continuations,
      contextTokenBudget: budget,
      keepRecentMessages: keep,
      compactionThresholdTokens: compaction,
      maxTokens: maxTokens === undefined ? null : maxTokens,
      temperature: temperature === undefined ? null : temperature,
      toolProfile: form.toolProfile.trim() || 'default',
      promptExtra: form.promptExtra,
    };
    setBusy(true);
    try {
      await saveProfile(code, input);
      toast(`预设 ${code} 已保存`);
      setForm(null);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (profile: AgentProfile): Promise<void> => {
    if (profile.profileCode === DEFAULT_PROFILE_CODE) {
      toast('default 默认预设不可删除');
      return;
    }
    if (!window.confirm(`确认删除预设「${profile.displayName || profile.profileCode}」？`)) {
      return;
    }
    setBusy(true);
    try {
      await deleteProfile(profile.profileCode);
      toast(`预设 ${profile.profileCode} 已删除`);
      if (form?.profileCode === profile.profileCode) {
        setForm(null);
      }
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-panel">
      {error ? <div className="banner banner--error">{error}</div> : null}

      <div className="settings-toolbar">
        <span className="settings-toolbar__hint">
          预设按场景裁运行开销（模型偏好/思考强度/步数/预算/工具白名单/提示词补丁）；新会话可选不同预设。
        </span>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => setForm(emptyForm())}
        >
          新建预设
        </button>
      </div>

      <table className="settings-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>编码</th>
            <th>说明</th>
            <th>步数</th>
            <th>工具画像</th>
            <th>补丁摘要</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => (
            <tr key={profile.profileCode}>
              <td>{profile.displayName || profile.profileCode}</td>
              <td>
                {profile.profileCode}
                {profile.profileCode === DEFAULT_PROFILE_CODE ? (
                  <span className="badge badge--active">默认</span>
                ) : null}
              </td>
              <td className="settings-table__desc" title={profile.description ?? ''}>
                <span className="clamp-2">{profile.description || '—'}</span>
              </td>
              <td>{profile.maxStepsPerTurn}</td>
              <td>{profile.toolProfile}</td>
              <td className="settings-table__path">
                {profile.promptExtra
                  ? profile.promptExtra.length > 40
                    ? `${profile.promptExtra.slice(0, 40)}…`
                    : profile.promptExtra
                  : '—'}
              </td>
              <td className="settings-table__actions">
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => setForm(toForm(profile))}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  disabled={busy}
                  title={
                    profile.profileCode === DEFAULT_PROFILE_CODE
                      ? 'default 默认预设不可删除'
                      : '删除预设'
                  }
                  onClick={() => void handleDelete(profile)}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
          {profiles.length === 0 ? (
            <tr>
              <td colSpan={7}>加载中或暂无预设…</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {form ? (
        <div className="settings-form">
          <h3>{form.isNew ? '新建预设' : `编辑预设 ${form.profileCode}`}</h3>

          <label className="settings-form__row">
            <span>预设编码 *</span>
            <input
              value={form.profileCode}
              disabled={!form.isNew || busy}
              placeholder="如 faq、ops-triage（新会话可选）"
              onChange={(e) => patchForm({ profileCode: e.target.value })}
            />
          </label>

          <label className="settings-form__row">
            <span>显示名</span>
            <input
              value={form.displayName}
              disabled={busy}
              onChange={(e) => patchForm({ displayName: e.target.value })}
            />
          </label>

          <label className="settings-form__row">
            <span>说明（{form.description.length}/{MAX_DESCRIPTION}）</span>
            <textarea
              value={form.description}
              disabled={busy}
              rows={2}
              maxLength={MAX_DESCRIPTION}
              placeholder="一句话说明该预设的用途与风格"
              onChange={(e) => patchForm({ description: e.target.value })}
            />
          </label>

          <label className="settings-form__row">
            <span>模型偏好</span>
            <select
              value={form.modelCode}
              disabled={busy}
              onChange={(e) => patchForm({ modelCode: e.target.value })}
            >
              <option value="">默认（跟随生效渠道）</option>
              {modelCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-form__row">
            <span>思考强度</span>
            <select
              value={form.reasoningEffort}
              disabled={busy}
              onChange={(e) => patchForm({ reasoningEffort: e.target.value })}
            >
              {REASONING_EFFORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-form__row">
            <span>每轮最大步数</span>
            <input
              value={form.maxStepsPerTurn}
              disabled={busy}
              placeholder="如 FAQ 场景可设 2"
              onChange={(e) => patchForm({ maxStepsPerTurn: e.target.value })}
            />
          </label>

          <label className="settings-form__row">
            <span>截断续写次数</span>
            <input
              value={form.maxTokenContinuations}
              disabled={busy}
              onChange={(e) => patchForm({ maxTokenContinuations: e.target.value })}
            />
          </label>

          <label className="settings-form__row">
            <span>上下文 token 预算</span>
            <input
              value={form.contextTokenBudget}
              disabled={busy}
              onChange={(e) => patchForm({ contextTokenBudget: e.target.value })}
            />
          </label>

          <label className="settings-form__row">
            <span>保留近 N 条消息</span>
            <input
              value={form.keepRecentMessages}
              disabled={busy}
              onChange={(e) => patchForm({ keepRecentMessages: e.target.value })}
            />
          </label>

          <label className="settings-form__row">
            <span>压缩阈值（tokens）</span>
            <input
              value={form.compactionThresholdTokens}
              disabled={busy}
              onChange={(e) => patchForm({ compactionThresholdTokens: e.target.value })}
            />
          </label>

          <label className="settings-form__row">
            <span>maxTokens（可空）</span>
            <input
              value={form.maxTokens}
              disabled={busy}
              placeholder="留空 = 跟随引擎默认"
              onChange={(e) => patchForm({ maxTokens: e.target.value })}
            />
          </label>

          <label className="settings-form__row">
            <span>temperature（可空）</span>
            <input
              value={form.temperature}
              disabled={busy}
              placeholder="0~2，留空 = 跟随引擎默认"
              onChange={(e) => patchForm({ temperature: e.target.value })}
            />
          </label>

          <label className="settings-form__row">
            <span>工具画像码</span>
            <input
              value={form.toolProfile}
              disabled={busy}
              placeholder="default"
              onChange={(e) => patchForm({ toolProfile: e.target.value })}
            />
            <small>
              接工具目录画像白名单（harness_tool_profile_binding）：决定本预设下模型可见的工具面；
              填该画像的编码，留空按 default。
            </small>
          </label>

          <label className="settings-form__row">
            <span>
              提示词补丁（{form.promptExtra.length}/{MAX_PROMPT_EXTRA}）
            </span>
            <textarea
              value={form.promptExtra}
              disabled={busy}
              rows={5}
              maxLength={MAX_PROMPT_EXTRA}
              placeholder="追加到系统提示词的场景指令，如「只简答，不展开推理」"
              onChange={(e) => patchForm({ promptExtra: e.target.value })}
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
