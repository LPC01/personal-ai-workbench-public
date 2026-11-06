/**
 * 多智能体编排纯逻辑（29 号 SPEC §16 模型解析 + §19 工具权限）。
 * domain 包保持纯净，不依赖 contracts；类型与 contracts 结构兼容。
 */

/** 工具策略（与 contracts.ToolPolicy 结构兼容）。 */
export interface ToolPolicy {
  allowedTools: string[];
  deniedTools?: string[];
  /** 是否允许扩展权限（默认 false，扩展需人工批准）。 */
  allowPermissionExpansion?: boolean;
}

/** 模型绑定（与 contracts.ModelBinding 结构兼容）。 */
export interface ModelBinding {
  modelProfileId: string;
  providerId?: string;
  revision: number;
  override?: Record<string, unknown>;
}

/**
 * 工具权限交集（§19 ROOM-SEC-001）：
 * Participant 权限为 Room、Project、AgentProfile、ToolPolicy 的交集。
 * - allowedTools：所有策略白名单的交集；
 * - deniedTools：所有策略拒绝列表的并集（任一策略拒绝即拒绝）；
 * - allowPermissionExpansion：仅当所有策略都允许时才为 true。
 */
export function intersectToolPolicies(policies: ToolPolicy[]): ToolPolicy {
  if (policies.length === 0) {
    return { allowedTools: [], deniedTools: [], allowPermissionExpansion: false };
  }
  const first = policies[0] as ToolPolicy;
  const allowedTools = first.allowedTools.filter((tool: string) =>
    policies.every((p) => p.allowedTools.includes(tool)),
  );
  const deniedTools = Array.from(new Set(policies.flatMap((p) => p.deniedTools ?? [])));
  const effectiveAllowed = allowedTools.filter((tool: string) => !deniedTools.includes(tool));
  const allowPermissionExpansion = policies.every((p) => p.allowPermissionExpansion === true);
  const result: ToolPolicy = { allowedTools: effectiveAllowed, deniedTools };
  if (allowPermissionExpansion) result.allowPermissionExpansion = true;
  return result;
}

/**
 * 模型绑定解析（§16）：Run override > AgentProfile > Room > Project > Global。
 * `candidates` 按优先级降序排列，返回第一个非空绑定。
 */
export function resolveModelBinding(
  candidates: (ModelBinding | undefined | null)[],
): ModelBinding | undefined {
  return candidates.find(
    (c): c is ModelBinding => c !== undefined && c !== null && c.modelProfileId !== '',
  );
}
