/**
 * 应用入口：挂载 App。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme, loadThemeMode } from './lib/theme';
import './styles.css';

// F1：渲染前写入 data-theme，避免主题闪烁（默认跟随系统）
applyTheme(loadThemeMode());

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到 #root 挂载点');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
