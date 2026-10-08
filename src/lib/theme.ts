/**
 * 主题体系（F1）：dark | light | system 三态。
 * - 解析后写入 <html data-theme="dark|light">，styles.css 按属性取令牌；
 * - 默认跟随系统 prefers-color-scheme，localStorage（键 jnf-theme）记忆用户选择；
 * - system 模式下监听系统主题变化实时切换。
 */

export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'jnf-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

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

/** 把模式应用到 <html data-theme>，返回实际生效主题。 */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
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
