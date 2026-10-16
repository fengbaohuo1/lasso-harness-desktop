/**
 * 主题体系（F1）：dark | light | system 三态。
 * - 解析后写入 <html data-theme="dark|light">，styles.css 按属性取令牌；
 * - 默认跟随系统 prefers-color-scheme，localStorage（键 jnf-theme）记忆用户选择；
 * - system 模式下监听系统主题变化实时切换；
 * - P11-12：同时把主题推给 Tauri 窗口（`setTheme`），让 Windows 原生标题栏与 WebView 一致；
 *   桌面壳外（纯浏览器 vite dev）静默跳过 —— 调用失败不能影响网页侧换肤。
 */

export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'jnf-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * P11-12：把主题同步到原生窗口标题栏。
 * 动态 import 是为了纯浏览器环境（无 Tauri 全局对象）下不报错，也让主包不必为它增大。
 */
export async function applyNativeTheme(resolved: ResolvedTheme): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTheme(resolved === 'light' ? 'light' : 'dark');
  } catch {
    /* 非 Tauri 环境或未授权（ACL 缺 core:window:allow-set-theme）时忽略 */
  }
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
  }
  return mode;
}

export function loadThemeMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'dark' || raw === 'light' || raw === 'system') {
      return raw;
    }
  } catch {
    /* localStorage 不可用时跟随系统 */
  }
  return 'system';
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* 隐私模式等场景静默 */
  }
}

/** 把模式应用到 <html data-theme> 并同步原生标题栏，返回实际生效主题。 */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  void applyNativeTheme(resolved);
  return resolved;
}

/** 跟随系统主题变化；返回取消订阅函数。 */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia?.(DARK_QUERY);
  if (!query) {
    return () => undefined;
  }
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** 三态轮换：system → dark → light → system。 */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'system' ? 'dark' : mode === 'dark' ? 'light' : 'system';
}

export const THEME_MODE_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  dark: '深色',
  light: '亮色',
};
