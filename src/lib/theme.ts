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
 * P11-14：系统真实主题缓存。
 *
 * 为什么需要它：Windows 上 WebView2 的 `prefers-color-scheme` 默认取自窗口主题，
 * 而窗口主题又由我们自己 `setTheme` 决定 —— 只靠 matchMedia 会形成自锁：
 * 系统是暗色、WebView 报亮色 → 我们把窗口设成亮色 → WebView 继续报亮色。
 * 改成「跟随系统时不设窗口覆盖，并从原生窗口问系统主题」后，这条环路才断开。
 */
let nativeSystemTheme: ResolvedTheme | null = null;

/** 记录原生窗口报告的系统主题（null = 未知，回退 matchMedia）。 */
export function setNativeSystemTheme(theme: ResolvedTheme | null): void {
  nativeSystemTheme = theme;
}

/**
 * P11-12：把主题同步到原生窗口标题栏。
 * P11-14：`system` 模式必须传 null 清掉窗口级覆盖，否则 WebView 的 prefers-color-scheme
 * 会被钉死在我们设的那一侧（见上面 nativeSystemTheme 的注释）。
 * 动态 import 是为了纯浏览器环境（无 Tauri 全局对象）下不报错，也让主包不必为它增大。
 */
export async function applyNativeTheme(mode: ThemeMode, resolved: ResolvedTheme): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTheme(mode === 'system' ? null : resolved);
  } catch {
    /* 非 Tauri 环境或未授权（ACL 缺 core:window:allow-set-theme）时忽略 */
  }
}

/** 读取原生窗口（= 系统）主题；Tauri 不可用时返回 null。 */
export async function readNativeSystemTheme(): Promise<ResolvedTheme | null> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const theme = await getCurrentWindow().theme();
    return theme === 'dark' || theme === 'light' ? theme : null;
  } catch {
    return null;
  }
}

/** 订阅原生窗口主题变化（系统切换深/浅色）；返回取消订阅函数。 */
export async function watchNativeTheme(
  onChange: (theme: ResolvedTheme) => void,
): Promise<() => void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return await getCurrentWindow().onThemeChanged(({ payload }) => {
      if (payload === 'dark' || payload === 'light') {
        onChange(payload);
      }
    });
  } catch {
    return () => undefined;
  }
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    if (nativeSystemTheme) {
      return nativeSystemTheme;
    }
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
  void applyNativeTheme(mode, resolved);
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
