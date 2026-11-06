/**
 * Harness 与工具契约（26 SPEC §13、§6.9 设计、29 SPEC §3/§6/§7）。
 *
 * Harness 只能看到当前 Run 允许的工具（§13 白名单），禁止暴露通用 Shell、
 * 任意路径文件系统、Credential Store 或平台数据库写权限。
 */

/** Harness 可用的工具 ID 白名单（26 SPEC §13）。 */
export const harnessToolIds = [
  'project.describe',
  'project.commands.list',
  'project.command.run',
  'run.status',
  'run.events',
  'run.cancel',
  'artifact.list',
  'artifact.read',
  'artifact.publish',
  'memory.search',
  'memory.read',
  'memory.candidate',
  'approval.request',
  'approval.status',
] as const;

export type HarnessToolId = (typeof harnessToolIds)[number];

/** 判断给定字符串是否为合法 Harness 工具 ID。 */
export function isHarnessTool(value: string): value is HarnessToolId {
  return (harnessToolIds as readonly string[]).includes(value);
}

/** Harness Adapter 类型（26 SPEC §13 + 设计 §6.9）：可替换的 Agent 内核。 */
export type HarnessAdapterType = 'deepseek' | 'openai-agents' | 'mock';

/**
 * Harness Profile（连接层配置，不含凭据）。
 * 凭据只存 credentialRef（见 P3-02 Credential Store），不落本结构。
 */
export interface HarnessProfile {
  id: string;
  name: string;
  adapterType: HarnessAdapterType;
  config: Record<string, unknown>;
  /** 配置修订号：每次变更递增，供 ExecutionBinding 快照引用。 */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** 创建/更新 Harness Profile 的输入（id 存在则修订 +1，否则新建修订 1）。 */
export interface HarnessProfileInput {
  id: string;
  name: string;
  adapterType: HarnessAdapterType;
  config?: Record<string, unknown>;
}

/**
 * 工具策略：允许的工具 ID 与参数约束（26 SPEC §13 + 29 SPEC §6）。
 * 工具返回值必须带稳定 ID，不得返回主机绝对路径（除非仅在受控 Builder 内使用）。
 */
export interface ToolPolicy {
  allowedToolIds: HarnessToolId[];
  /** 参数级约束，如 `project.command.run` 限定允许的 commandId 白名单。 */
  constraints: Record<string, unknown>;
}

/** 上下文快照：不可变上下文引用（26 SPEC §17 + 29 SPEC §7 并发隔离）。 */
export interface ContextSnapshot {
  /** 内容哈希，保证不可变。 */
  hash: string;
  revision: number;
  projectId: string | null;
  createdAt: string;
}

/** Harness Session 状态。 */
export type HarnessSessionStatus = 'created' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Harness Session：单个 Agent 的隔离会话与上下文游标（29 SPEC §3/§7）。
 * 每个 Agent 必须拥有独立 Session，不共享隐藏上下文。
 */
export interface HarnessSession {
  id: string;
  harnessProfileId: string;
  modelProfileId: string;
  agentProfileId: string | null;
  toolPolicy: ToolPolicy;
  status: HarnessSessionStatus;
  /** 上下文游标：指向已消费事件序列，用于断线续传。 */
  contextCursor: number;
  /** 会话修订号：绑定模型/策略快照，进行中禁止热切换。 */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * ExecutionBinding：把一次平台 Run 绑定到 Harness + Session + 模型 + 工具策略 + 上下文快照。
 * 所有字段在 Run 创建时固定（26 SPEC §17「每次模型调用固定修订，进行中禁止热切换」）。
 */
export interface ExecutionBinding {
  runId: string;
  sessionId: string;
  harnessProfileId: string;
  modelProfileId: string;
  toolPolicy: ToolPolicy;
  contextSnapshot: ContextSnapshot;
  /** 绑定固定时间戳（ISO 8601）。 */
  fixedAt: string;
}
