/**
 * 设置对话框（SD6 + F4 + A4 + P8-2 + P9-5）：纵向导航（分组图标 + 文字）+ 内容区白卡。
 * - 分组：AI 能力（模型渠道/智能体预设/工具注册）· 扩展（插件管理，带计数徽标 / 技能）· 系统（工作区/关于）；
 * - 导航底部固定：绿点（带光环）+ 服务状态；
 * - 保留 initialTab 直达（欢迎页快捷入口）；Esc 关闭由 App 全局键位处理。
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import AboutPanel from './AboutPanel';
import ModelSettingsPanel from './ModelSettingsPanel';
import PluginSettingsPanel from './PluginSettingsPanel';
import ProfileSettingsPanel from './ProfileSettingsPanel';
import SkillsPanel from './SkillsPanel';
import ToolCatalogPanel from './ToolCatalogPanel';
import WorkspacePanel from './WorkspacePanel';
import {
  CloseIcon,
  GearIcon,
  InfoIcon,
  ModelIcon,
  PluginIcon,
  PresetIcon,
  SkillIcon,
  ToolsIcon,
  WorkspaceIcon,
} from './icons';
import { listPlugins } from '../lib/settings-client';

export interface SettingsDialogProps {
  onClose: () => void;
  /** 初始页签（欢迎页快捷入口直达用），默认模型渠道。 */
  initialTab?: Tab;
  /** 服务运行态（导航底部绿点行）。 */
  serviceRunning?: boolean;
}

export type Tab =
  | 'models'
  | 'profiles'
  | 'tools'
  | 'plugins'
  | 'skills'
  | 'workspaces'
  | 'about';

interface NavItem {
  key: Tab;
  label: string;
  icon: ReactElement;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'AI 能力',
    items: [
      { key: 'models', label: '模型渠道', icon: <ModelIcon /> },
      { key: 'profiles', label: '智能体预设', icon: <PresetIcon /> },
      { key: 'tools', label: '工具注册', icon: <ToolsIcon /> },
    ],
  },
  {
    title: '扩展',
    items: [
      { key: 'plugins', label: '插件管理', icon: <PluginIcon /> },
      { key: 'skills', label: '技能', icon: <SkillIcon /> },
    ],
  },
  {
    title: '系统',
    items: [
      { key: 'workspaces', label: '工作区', icon: <WorkspaceIcon /> },
      { key: 'about', label: '关于', icon: <InfoIcon /> },
    ],
  },
];

const PAGE_TITLES: Record<Tab, string> = {
  models: '模型渠道',
  profiles: '智能体预设',
  tools: '工具注册',
  plugins: '插件管理',
  skills: '技能',
  workspaces: '工作区',
  about: '关于',
};

export default function SettingsDialog({
  onClose,
  initialTab = 'models',
  serviceRunning = true,
}: SettingsDialogProps): ReactElement {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [pluginCount, setPluginCount] = useState<number | null>(null);

  // 插件管理项计数徽标（拉不到就不显示）
  useEffect(() => {
    void listPlugins()
      .then((plugins) => setPluginCount(plugins.length))
      .catch(() => setPluginCount(null));
  }, []);

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true">
      <div className="settings-dialog">
        <header className="settings-dialog__header">
          <div className="settings-dialog__title">
            <GearIcon />
            <span>设置</span>
          </div>
          <button type="button" className="icon-btn" title="关闭（Esc）" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="settings-dialog__body">
          <aside className="settings-nav">
            {NAV_GROUPS.map((group) => (
              <div className="settings-nav__group" key={group.title}>
                <div className="settings-nav__group-title">{group.title}</div>
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={
                      tab === item.key
                        ? 'settings-nav__item settings-nav__item--active'
                        : 'settings-nav__item'
                    }
                    aria-current={tab === item.key ? 'page' : undefined}
                    onClick={() => setTab(item.key)}
                  >
                    <span className="settings-nav__icon">{item.icon}</span>
                    <span className="settings-nav__label">{item.label}</span>
                    {item.key === 'plugins' && pluginCount != null ? (
                      <span className="settings-nav__count">{pluginCount}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
            <div className="settings-nav__footer">
              <span
                className={`status-dot${serviceRunning ? ' status-dot--ok' : ''}`}
                aria-hidden="true"
              />
              <span>{serviceRunning ? '服务运行中' : '服务未运行'}</span>
            </div>
          </aside>
          <main className="settings-content">
            <div className="settings-page">
              <h2 className="settings-page__title">{PAGE_TITLES[tab]}</h2>
              <div className="set-card">
                {tab === 'models' ? <ModelSettingsPanel /> : null}
                {tab === 'profiles' ? <ProfileSettingsPanel /> : null}
                {tab === 'tools' ? <ToolCatalogPanel /> : null}
                {tab === 'plugins' ? <PluginSettingsPanel /> : null}
                {tab === 'skills' ? <SkillsPanel /> : null}
                {tab === 'workspaces' ? <WorkspacePanel /> : null}
                {tab === 'about' ? <AboutPanel /> : null}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
