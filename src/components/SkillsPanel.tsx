/**
 * 设置 · 技能管理面板（SKILL.md 运行时）：
 * - 列表：名称（等宽加粗）+ 来源徽标 + 说明 + 触发时机 + 路径（title 提示）；
 * - 查看：按需 getSkill 拉取 SKILL.md 正文，行内展开 <pre> 等宽展示（保留滚动）；
 * - 启用/禁用：POST .../enable | .../disable，返回更新后的摘要就地替换；
 * - 删除：仅 USER 来源可删（项目级/内置技能由仓库/安装包管理），走应用内确认框；
 * - 安装：Git URL（必填）+ 可选 subdir/name，结果 message 成功/失败都原样展示，成功后刷新列表。
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { confirmAction } from '../lib/confirm';
import {
  getSkill,
  installSkill,
  listSkills,
  removeSkill,
  setSkillEnabled,
} from '../lib/settings-client';
import type { SkillInstallResult, SkillItem, SkillSource } from '../lib/settings-client';
import { toast } from '../lib/toast';

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 来源展示文案 + 徽标说明（优先级 PROJECT > CUSTOM > USER > BUNDLED）。 */
const SOURCE_META: Record<SkillSource, { label: string; title: string; badgeClass: string }> = {
  PROJECT: {
    label: '项目',
    title: '项目级技能：<cwd>/.jnf/skills，优先级最高',
    badgeClass: 'badge badge--active',
  },
  CUSTOM: {
    label: '自定义',
    title: '配置追加的技能根目录（harness.skills.roots）',
    badgeClass: 'badge',
  },
  USER: {
    label: '用户',
    title: '用户级技能：~/.jnf/skills；可启用/禁用/删除',
    badgeClass: 'badge',
  },
  BUNDLED: {
    label: '内置',
    title: '随包内置技能，不可删除',
    badgeClass: 'badge badge--muted',
  },
};

/** 行内展开的 SKILL.md 详情（按需加载）。 */
interface DetailState {
  name: string;
  loading: boolean;
  content: string;
  error: string | null;
}

interface InstallFormState {
  gitUrl: string;
  subdir: string;
  name: string;
}

const EMPTY_INSTALL_FORM: InstallFormState = { gitUrl: '', subdir: '', name: '' };

export default function SkillsPanel(): ReactElement {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);

  const [form, setForm] = useState<InstallFormState>(EMPTY_INSTALL_FORM);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<SkillInstallResult | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSkills(await listSkills());
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patchForm = (patch: Partial<InstallFormState>): void => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const handleToggleEnabled = (skill: SkillItem): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    void setSkillEnabled(skill.name, !skill.enabled)
      .then((updated) => {
        setSkills((prev) => prev.map((item) => (item.name === updated.name ? updated : item)));
        toast(
          updated.enabled ? `已启用技能 ${updated.name}` : `已禁用技能 ${updated.name}`,
          'success',
        );
      })
      .catch((err) => toast(describeError(err), 'error'))
      .finally(() => setBusy(false));
  };

  /** 展开/收起：展开时按需拉 SKILL.md 正文（收起不重复请求）。 */
  const handleToggleDetail = (skill: SkillItem): void => {
    if (detail?.name === skill.name) {
      setDetail(null);
      return;
    }
    setDetail({ name: skill.name, loading: true, content: '', error: null });
    void getSkill(skill.name)
      .then((full) => {
        setDetail((prev) =>
          prev?.name === skill.name
            ? { name: skill.name, loading: false, content: full.content, error: null }
            : prev,
        );
      })
      .catch((err) => {
        const message = describeError(err);
        setDetail((prev) =>
          prev?.name === skill.name
            ? { name: skill.name, loading: false, content: '', error: message }
            : prev,
        );
        toast(`技能详情加载失败：${message}`, 'error');
      });
  };

  const handleRemove = async (skill: SkillItem): Promise<void> => {
    if (busy) {
      return;
    }
    const confirmed = await confirmAction({
      title: '删除技能',
      message: `确认删除技能「${skill.name}」？\n将删除用户级技能目录下的 SKILL.md 包，操作不可撤销。`,
      confirmLabel: '删除',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await removeSkill(skill.name);
      toast(`技能 ${skill.name} 已删除`, 'success');
      if (detail?.name === skill.name) {
        setDetail(null);
      }
      await refresh();
    } catch (err) {
      toast(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = async (): Promise<void> => {
    if (installing) {
      return;
    }
    const gitUrl = form.gitUrl.trim();
    if (!gitUrl) {
      setInstallResult(null);
      toast('Git URL 不能为空', 'error');
      return;
    }
    setInstalling(true);
    try {
      const result = await installSkill({
        gitUrl,
        subdir: form.subdir.trim() || undefined,
        name: form.name.trim() || undefined,
      });
      setInstallResult(result);
      if (result.success) {
        toast(result.name ? `技能 ${result.name} 安装成功` : '技能安装成功', 'success');
        setForm(EMPTY_INSTALL_FORM);
        await refresh();
      } else {
        toast(`技能安装失败：${result.message}`, 'error');
      }
    } catch (err) {
      const message = describeError(err);
      setInstallResult({ success: false, name: '', path: '', message });
      toast(`技能安装失败：${message}`, 'error');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="settings-panel">
      {error ? <div className="banner banner--error">{error}</div> : null}

      <div className="settings-toolbar">
        <span className="settings-toolbar__hint">
          技能是 SKILL.md 指令包（Markdown + YAML frontmatter），运行时按需载入模型上下文。
          项目级 .jnf/skills 优先于用户级 ~/.jnf/skills，同名技能由高优先级来源覆盖。
        </span>
        <button
          type="button"
          className="btn"
          disabled={loading || busy}
          title="重新拉取技能列表"
          onClick={() => void refresh()}
        >
          刷新
        </button>
      </div>

      <div className="settings-form skills-install-form">
        <h3>安装技能</h3>
        <label className="settings-form__row">
          <span>Git URL *</span>
          <input
            value={form.gitUrl}
            disabled={installing}
            placeholder="https://github.com/owner/repo.git"
            onChange={(e) => patchForm({ gitUrl: e.target.value })}
          />
        </label>
        <label className="settings-form__row">
          <span>子目录（可选）</span>
          <input
            value={form.subdir}
            disabled={installing}
            placeholder="技能不在仓库根时填写，如 skills/my-skill"
            onChange={(e) => patchForm({ subdir: e.target.value })}
          />
        </label>
        <label className="settings-form__row">
          <span>技能名（可选）</span>
          <input
            value={form.name}
            disabled={installing}
            placeholder="缺省取 SKILL.md frontmatter 的 name"
            onChange={(e) => patchForm({ name: e.target.value })}
          />
        </label>
        <div className="settings-form__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={installing}
            onClick={() => void handleInstall()}
          >
            {installing ? '安装中…' : '安装'}
          </button>
        </div>
        <div className="settings-panel__hint">
          从 Git 仓库克隆到用户级技能目录（~/.jnf/skills）；安装成功后列表自动刷新。
        </div>
        {installResult ? (
          <div
            className={`banner ${installResult.success ? 'banner--info' : 'banner--error'}`}
            title={installResult.path || undefined}
          >
            {installResult.success ? '安装成功' : '安装失败'}
            {installResult.name ? `（${installResult.name}）` : ''}：{installResult.message}
            {installResult.success && installResult.path ? `；路径：${installResult.path}` : ''}
          </div>
        ) : null}
      </div>

      <h3>已安装技能</h3>
      <div className="settings-panel__hint">
        删除仅对用户级（USER）技能生效；项目级与内置技能随仓库/安装包管理。
      </div>
      <div className="settings-table-wrap settings-table-wrap--skills">
        <table className="settings-table">
          <colgroup>
            <col style={{ width: '19%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>名称</th>
              <th>来源</th>
              <th>说明</th>
              <th>触发时机</th>
              <th>路径</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {skills.map((skill) => {
              const meta = SOURCE_META[skill.source];
              const expanded = detail?.name === skill.name;
              return (
                <Fragment key={skill.name}>
                  <tr>
                    <td className="settings-table__mono" title={skill.name}>
                      <span className="skill-name">{skill.name}</span>
                    </td>
                    <td>
                      <span className={meta.badgeClass} title={meta.title}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="settings-table__desc" title={skill.description}>
                      {skill.description || '—'}
                    </td>
                    <td className="settings-table__desc" title={skill.whenToUse}>
                      {skill.whenToUse || '—'}
                    </td>
                    <td className="settings-table__path" title={skill.path}>
                      {skill.path}
                    </td>
                    <td className="settings-table__actions">
                      <button
                        type="button"
                        className="btn btn--small"
                        title={expanded ? '收起 SKILL.md 正文' : '查看 SKILL.md 正文'}
                        onClick={() => handleToggleDetail(skill)}
                      >
                        {expanded ? '收起' : '查看'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--small"
                        disabled={busy}
                        title={skill.enabled ? '禁用该技能（不再载入模型上下文）' : '启用该技能'}
                        onClick={() => handleToggleEnabled(skill)}
                      >
                        {skill.enabled ? '禁用' : '启用'}
                      </button>
                      {skill.source === 'USER' ? (
                        <button
                          type="button"
                          className="btn btn--small btn--danger"
                          disabled={busy}
                          title="删除用户级技能（不可撤销）"
                          onClick={() => void handleRemove(skill)}
                        >
                          删除
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {expanded ? (
                    <tr>
                      <td className="settings-table__wide" colSpan={6}>
                        <div className="skill-detail">
                          <div className="skill-detail__meta">
                            <span>SKILL.md 正文</span>
                            <code className="skill-detail__path" title={skill.path}>
                              {skill.path}
                            </code>
                          </div>
                          {detail.loading ? (
                            <div className="settings-table__muted">正在加载 SKILL.md…</div>
                          ) : detail.error ? (
                            <div className="banner banner--error">{detail.error}</div>
                          ) : (
                            <pre className="skill-detail__content">
                              {detail.content || '（SKILL.md 正文为空）'}
                            </pre>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {loading ? (
              <tr>
                <td className="settings-empty" colSpan={6}>
                  正在加载技能列表…
                </td>
              </tr>
            ) : null}
            {!loading && skills.length === 0 ? (
              <tr>
                <td className="settings-empty" colSpan={6}>
                  暂无技能，可通过上方 Git URL 安装。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
