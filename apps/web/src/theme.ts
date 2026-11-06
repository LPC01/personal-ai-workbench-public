/**
 * 主题模式管理（30 号视觉基线 §3.2：支持浅色和深色主题）。
 *
 * 三态：`system`（跟随系统偏好）/ `light` / `dark`。
 * 解析后的结果写到 `<html data-theme>`，CSS 令牌据此切换，无 React 重渲染。
 * 偏好持久化在 localStorage（不可用时降级为仅当前会话生效）。
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'wb-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function canMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/** 当前操作系统的深浅色偏好。 */
export function getSystemTheme(): ResolvedTheme {
  if (!canMatchMedia()) return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/** 把三态模式解析为实际生效的浅色/深色。 */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

/** 读取已保存的模式；缺失或非法值回落到「跟随系统」。 */
export function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** 应用模式（写 `<html data-theme>`），返回实际生效的主题。 */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved);
  }
  return resolved;
}

/** 持久化并应用模式。 */
export function setThemeMode(mode: ThemeMode): ResolvedTheme {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // 隐私模式等场景 localStorage 不可用：忽略持久化，本次会话仍生效
    }
  }
  return applyTheme(mode);
}

/** 订阅系统主题变化。返回取消订阅函数。 */
export function subscribeSystemTheme(onChange: () => void): () => void {
  if (!canMatchMedia()) return () => {};
  const mql = window.matchMedia(DARK_QUERY);
  const handler = () => onChange();
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}

/** 主题切换控件的选项。 */
export const THEME_MODES: readonly { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];
