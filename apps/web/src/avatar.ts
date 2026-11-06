/**
 * 头像相关的稳定派生工具：项目卡片与 Provider 卡片共用同一套取色/取首字规则，
 * 避免两处各写一份导致视觉不一致。
 */

/** 由稳定标识推导头像色相：同一 id 每次渲染颜色一致，不同 id 尽量分开。 */
export function avatarHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  return hash;
}

/** 头像首字：取首个字符并转大写（兼容多字节字符）。 */
export function avatarInitial(name: string): string {
  const trimmed = name.trim();
  const chars = Array.from(trimmed);
  return chars.length === 0 ? '?' : (chars[0] ?? '?').toUpperCase();
}
