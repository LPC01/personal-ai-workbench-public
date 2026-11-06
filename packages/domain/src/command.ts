/**
 * 项目命令与作用域纯逻辑（29 号 SPEC §13 项目、命令和 Web UI 集成）。
 * domain 包保持纯净，不依赖 contracts；类型与 contracts 结构兼容。
 */

/** 项目访问权限（§13.1 room_projects.access）。 */
export type ProjectAccess = 'read' | 'execute';

/** 命令权限校验（§13.2）：命令必须在项目 Manifest 登记且 ToolPolicy 允许。返回错误或 null。 */
export function assertCommandAllowed(
  commandId: string,
  allowedTools: ReadonlySet<string>,
  registeredCommandIds: ReadonlySet<string>,
): string | null {
  if (!registeredCommandIds.has(commandId)) {
    return `命令 ${commandId} 未在项目 Manifest 登记`;
  }
  if (!allowedTools.has(commandId)) {
    return `命令 ${commandId} 不在 ToolPolicy 允许集合`;
  }
  return null;
}

/**
 * 项目作用域校验（§13.6：多项目 Room 默认只读，写操作必须明确标注目标项目）。
 * - 写操作缺少 projectId → 拒绝；
 * - projectId 未绑定 → 拒绝；
 * - 写操作但权限非 execute → 拒绝。
 */
export function assertProjectScope(
  projectId: string | undefined,
  access: ProjectAccess | undefined,
  requiresWrite: boolean,
): string | null {
  if (projectId === undefined) {
    return requiresWrite ? '写操作必须明确标注目标项目' : null;
  }
  if (access === undefined) {
    return `项目 ${projectId} 未绑定到 Room`;
  }
  if (requiresWrite && access !== 'execute') {
    return `项目 ${projectId} 无执行权限（当前 ${access}）`;
  }
  return null;
}
