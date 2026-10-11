/**
 * 设置对话框（SD6 + F4 + A4 + P8-2）：五页签——模型渠道（M6）/ 智能体画像（A4）/
 * 工具注册（P8-2）/ 插件管理（P4）/ 关于（F4）。
 */

import { useState } from 'react';
import type { ReactElement } from 'react';
import AboutPanel from './AboutPanel';
import ModelSettingsPanel from './ModelSettingsPanel';
import PluginSettingsPanel from './PluginSettingsPanel';
import ProfileSettingsPanel from './ProfileSettingsPanel';
import ToolCatalogPanel from './ToolCatalogPanel';

export interface SettingsDialogProps {
  onClose: () => void;
  /** 初始页签（欢迎页快捷入口直达用），默认模型渠道。 */
  initialTab?: Tab;
}

export type Tab = 'models' | 'profiles' | 'tools' | 'plugins' | 'about';

const TABS: Array<[Tab, string]> = [
  ['models', '模型渠道'],
  ['profiles', '智能体画像'],
  ['tools', '工具注册'],
  ['plugins', '插件管理'],
  ['about', '关于'],
];

export default function SettingsDialog({
  onClose,
  initialTab = 'models',
}: SettingsDialogProps): ReactElement {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true">
      <div className="settings-dialog">
        <header className="settings-dialog__header">
          <div className="settings-tabs">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={
                  tab === key ? 'settings-tab settings-tab--active' : 'settings-tab'
                }
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--small" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="settings-dialog__body">
          {tab === 'models' ? <ModelSettingsPanel /> : null}
          {tab === 'profiles' ? <ProfileSettingsPanel /> : null}
          {tab === 'tools' ? <ToolCatalogPanel /> : null}
          {tab === 'plugins' ? <PluginSettingsPanel /> : null}
          {tab === 'about' ? <AboutPanel /> : null}
        </div>
      </div>
    </div>
  );
}
