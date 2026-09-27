/**
 * 设置对话框（SD6）：两页签——模型渠道（M6）/ 插件管理（P4）。
 */

import { useState } from 'react';
import type { ReactElement } from 'react';
import ModelSettingsPanel from './ModelSettingsPanel';
import PluginSettingsPanel from './PluginSettingsPanel';

export interface SettingsDialogProps {
  onClose: () => void;
}

type Tab = 'models' | 'plugins';

export default function SettingsDialog({ onClose }: SettingsDialogProps): ReactElement {
  const [tab, setTab] = useState<Tab>('models');

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true">
      <div className="settings-dialog">
        <header className="settings-dialog__header">
          <div className="settings-tabs">
            <button
              type="button"
              className={tab === 'models' ? 'settings-tab settings-tab--active' : 'settings-tab'}
              onClick={() => setTab('models')}
            >
              模型渠道
            </button>
            <button
              type="button"
              className={tab === 'plugins' ? 'settings-tab settings-tab--active' : 'settings-tab'}
              onClick={() => setTab('plugins')}
            >
              插件管理
            </button>
          </div>
          <button type="button" className="btn btn--small" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="settings-dialog__body">
          {tab === 'models' ? <ModelSettingsPanel /> : <PluginSettingsPanel />}
        </div>
      </div>
    </div>
  );
}
