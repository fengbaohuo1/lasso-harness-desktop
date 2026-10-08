/**
 * 插件独立配置页（U3，用户重点要求）：插件管理点开某插件 → 它专属的配置页面——
 * 标题/描述 + sections 分组表单 + actions 动作按钮 + 底部保存（PUT config，只提交表单出现过的 key）。
 * 声明 settingsPage 的插件走表单；未声明 → 回退 KV 编辑器并提示「该插件未声明配置页面，可升级插件清单」；
 * schemaVersion 超版本 → 提示升级桌面端 + KV 回退（不硬渲新清单）。
 * 值与 KV 互转：text/password/textarea/select→原串、number→数字串、checkbox→"true"/"false"。
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  deletePluginConfigKey,
  getPluginConfig,
  savePluginConfig,
} from '../lib/settings-client';
import type { PluginItem } from '../lib/settings-client';
import { executePluginAction, formValueToKv, isUiSupported, kvToFormValue, type FormValue } from '../lib/plugin-ui';
import { toast } from '../lib/toast';
import type { PluginUiAction, PluginUiField, PluginUiManifest, PluginSettingsPage } from '../types';

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ----------------------------- KV 编辑器（回退页） ----------------------------- */

interface ConfigRow {
  key: string;
  value: string;
}

function KvConfigEditor({ pluginId }: { pluginId: string }): ReactElement {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      toast('配置已保存（持久化）', 'success');
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
      {error ? <div className="banner banner--error">{error}</div> : null}
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

/* ----------------------------- settingsPage 表单 ----------------------------- */

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: PluginUiField;
  value: FormValue;
  onChange: (next: FormValue) => void;
}): ReactElement {
  switch (field.type) {
    case 'checkbox':
      return (
        <label className="plugin-form__check">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
    case 'select':
      return (
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label || option.value}
            </option>
          ))}
        </select>
      );
    case 'textarea':
      return (
        <textarea
          value={String(value)}
          placeholder={field.placeholder}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          value={value === '' ? '' : String(value)}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    default:
      return (
        <input
          type={field.type === 'password' ? 'password' : 'text'}
          value={String(value)}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function SettingsPageForm({
  pluginId,
  page,
  formValues,
  setFormValues,
  onSaved,
}: {
  pluginId: string;
  page: PluginSettingsPage;
  formValues: Record<string, FormValue>;
  setFormValues: (next: Record<string, FormValue>) => void;
  onSaved?: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidKeys, setInvalidKeys] = useState<string[]>([]);

  const fields: PluginUiField[] = (page.sections ?? []).flatMap((section) => section.fields ?? []);

  const setValue = (key: string, next: FormValue): void => {
    setFormValues({ ...formValues, [key]: next });
    setInvalidKeys((prev) => prev.filter((k) => k !== key));
  };

  const handleSave = async (): Promise<void> => {
    // required 校验：空值阻止保存并提示
    const invalid = fields
      .filter((field) => field.required && String(formValues[field.key] ?? '').trim() === '')
      .map((field) => field.key);
    if (invalid.length > 0) {
      setInvalidKeys(invalid);
      toast('请填写必填项', 'error');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 只提交表单里出现过的 key（未声明字段的既有配置不动）
      const config: Record<string, string> = {};
      for (const field of fields) {
        config[field.key] = formValueToKv(field, formValues[field.key]);
      }
      await savePluginConfig(pluginId, config);
      toast('配置已保存', 'success');
      onSaved?.();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const runAction = (action: PluginUiAction): void => {
    if (action.confirm && !window.confirm(action.confirm)) {
      return;
    }
    const body =
      (action.bodyFrom ?? '') === 'form'
        ? Object.fromEntries(fields.map((field) => [field.key, formValueToKv(field, formValues[field.key])]))
        : undefined;
    setBusy(true);
    executePluginAction(pluginId, action, body)
      .then((data) => {
        const detail =
          data == null ? '' : `：${(typeof data === 'string' ? data : JSON.stringify(data)).split('\n')[0].slice(0, 120)}`;
        toast(`${action.label} 成功${detail}`, 'success');
      })
      .catch((err) => toast(`${action.label} 失败：${describeError(err)}`, 'error'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="plugin-form">
      {error ? <div className="banner banner--error">{error}</div> : null}
      {(page.sections ?? []).map((section, sectionIndex) => (
        <div className="plugin-form__section" key={section.title ?? sectionIndex}>
          {section.title ? <h4 className="plugin-form__section-title">{section.title}</h4> : null}
          {(section.fields ?? []).map((field) => (
            <div
              className={invalidKeys.includes(field.key) ? 'plugin-form__row plugin-form__row--invalid' : 'plugin-form__row'}
              key={field.key}
            >
              <span className="plugin-form__label">
                {field.label || field.key}
                {field.required ? <em className="plugin-form__required">*</em> : null}
              </span>
              <div className="plugin-form__control">
                <FieldControl
                  field={field}
                  value={formValues[field.key] ?? ''}
                  onChange={(next) => setValue(field.key, next)}
                />
                {field.help ? <div className="plugin-form__help">{field.help}</div> : null}
                {invalidKeys.includes(field.key) ? (
                  <div className="plugin-form__error">必填项不能为空</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ))}

      {(page.actions ?? []).length > 0 ? (
        <div className="plugin-form__actions">
          {(page.actions ?? []).map((action) => (
            <button
              key={`${action.method}-${action.path}`}
              type="button"
              className="btn btn--small"
              disabled={busy}
              onClick={() => runAction(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="settings-form__actions">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleSave()}>
          保存
        </button>
      </div>
    </div>
  );
}

/* ----------------------------- 配置页（页面壳） ----------------------------- */

export interface PluginConfigPageProps {
  plugin: PluginItem;
  /** UI 清单（可能 null=未声明；schemaVersion 超版本时只提示不硬渲）。 */
  manifest: PluginUiManifest | null;
  onBack: () => void;
  onSaved?: () => void;
}

export default function PluginConfigPage({
  plugin,
  manifest,
  onBack,
  onSaved,
}: PluginConfigPageProps): ReactElement {
  const supported = isUiSupported(manifest);
  const page = supported ? (manifest?.settingsPage ?? null) : null;

  const [formValues, setFormValues] = useState<Record<string, FormValue>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const fields: PluginUiField[] = (page?.sections ?? []).flatMap((section) => section.fields ?? []);

  useEffect(() => {
    if (!page) {
      return;
    }
    let cancelled = false;
    void getPluginConfig(plugin.pluginId)
      .then((kv) => {
        if (cancelled) {
          return;
        }
        const next: Record<string, FormValue> = {};
        for (const field of fields) {
          next[field.key] = kvToFormValue(field, kv);
        }
        setFormValues(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(describeError(err));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.pluginId, page]);

  const handleBack = useCallback(() => onBack(), [onBack]);

  return (
    <div className="plugin-config-page">
      <div className="plugin-config-page__header">
        <button type="button" className="btn btn--small" onClick={handleBack}>
          ← 返回插件列表
        </button>
        <div className="plugin-config-page__title">
          <span className="plugin-config-page__name">
            {page?.title || plugin.displayName || plugin.pluginId}
          </span>
          <span className="plugin-config-page__meta">
            {plugin.pluginId} · v{plugin.pluginVersion}
          </span>
          <span
            className={
              plugin.status === 'ACTIVE' ? 'badge badge--active' : plugin.status === 'FAILED' ? 'badge badge--danger' : 'badge badge--muted'
            }
          >
            {plugin.status}
          </span>
        </div>
      </div>

      {!supported && manifest ? (
        <div className="banner banner--info">插件 UI 清单版本较新，请升级桌面端（当前支持 schemaVersion 1）。</div>
      ) : null}

      {loadError ? <div className="banner banner--error">{loadError}</div> : null}

      {page ? (
        <>
          {page.description ? <p className="plugin-config-page__desc">{page.description}</p> : null}
          <SettingsPageForm
            pluginId={plugin.pluginId}
            page={page}
            formValues={formValues}
            setFormValues={setFormValues}
            onSaved={onSaved}
          />
        </>
      ) : (
        <>
          <div className="banner banner--info">
            该插件未声明配置页面，可升级插件清单（META-INF/plugin-ui.json 的 settingsPage）。
          </div>
          <KvConfigEditor pluginId={plugin.pluginId} />
        </>
      )}
    </div>
  );
}
