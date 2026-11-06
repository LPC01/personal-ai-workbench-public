/**
 * 聊天室安全纯逻辑（29 号 SPEC §19 安全要求）。
 * domain 包保持纯净，不依赖 contracts，不 import node: 模块。
 */

/** 规范化路径分隔符（统一为 `/`，去重、去尾斜杠）。 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

/**
 * 路径越界校验（§19 ROOM-SEC-008：消息附件路径必须通过项目根校验）。
 * 拒绝路径穿越（`..`）与根外路径。
 */
export function isPathWithinRoot(path: string, root: string): boolean {
  const p = normalizePath(path);
  const r = normalizePath(root);
  if (p.split('/').includes('..')) return false;
  return p === r || p.startsWith(`${r}/`);
}

/**
 * 可见范围校验（§19 ROOM-SEC-004：Agent 间共享前执行可见范围校验）。
 * `visibleTo` 含 `*` 表示全员可见；否则每个目标必须是允许参与者（发布者本人除外）。
 * 返回错误或 null。
 */
export function assertVisibility(
  actorId: string,
  visibleTo: string[],
  allowedParticipants: ReadonlySet<string>,
): string | null {
  if (visibleTo.includes('*')) return null;
  for (const target of visibleTo) {
    if (target !== actorId && !allowedParticipants.has(target)) {
      return `可见范围包含非参与者 ${target}`;
    }
  }
  return null;
}
