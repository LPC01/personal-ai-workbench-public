/**
 * 多智能体协作聊天室契约（29 号 SPEC §8 数据模型 + §9 状态机 + §10 RoomEvent）。
 * 首期仅定义 Schema 与状态/事件类型；编排逻辑属 MA-02～MA-09。
 */

export type RoomType = 'general' | 'sdd-delivery';

/** Room 状态机（§9.1）：DRAFT → ACTIVE → ARCHIVED；ACTIVE → SUSPENDED → ACTIVE|ARCHIVED。 */
export type RoomStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

/** RoomRun 状态机（§9.2）。 */
export type RoomRunStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'READY'
  | 'RUNNING'
  | 'WAITING_AGENT'
  | 'WAITING_USER'
  | 'WAITING_APPROVAL'
  | 'PAUSED'
  | 'CANCELLING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'TIMED_OUT'
  | 'BUDGET_EXCEEDED';

/** RoomRun 终态（§9.2：不可逆）。 */
export const ROOM_RUN_TERMINAL_STATUSES: ReadonlySet<RoomRunStatus> = new Set([
  'SUCCEEDED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
  'TIMED_OUT',
  'BUDGET_EXCEEDED',
]);

/** WorkItem 状态机（§9.3）。 */
export type WorkItemStatus =
  | 'OPEN'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'VERIFYING'
  | 'ACCEPTED'
  | 'REWORK'
  | 'CANCELLED';

/** RoomEvent 类型（§10 首期 25 类）。 */
export type RoomEventType =
  | 'ROOM_RUN_CREATED'
  | 'CONTEXT_SNAPSHOT_CREATED'
  | 'USER_MESSAGE'
  | 'TASK_ASSIGNED'
  | 'AGENT_TURN_STARTED'
  | 'AGENT_MESSAGE'
  | 'TOOL_CALL_REQUESTED'
  | 'TOOL_CALL_COMPLETED'
  | 'PROPOSAL_SUBMITTED'
  | 'CRITIQUE_SUBMITTED'
  | 'EVIDENCE_ATTACHED'
  | 'BALLOT_SUBMITTED'
  | 'DECISION_PROPOSED'
  | 'DECISION_RECORDED'
  | 'HANDOFF_REQUESTED'
  | 'HANDOFF_COMPLETED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_RESOLVED'
  | 'BUDGET_WARNING'
  | 'ROOM_RUN_PAUSED'
  | 'ROOM_RUN_RESUMED'
  | 'ROOM_RUN_COMPLETED'
  | 'MEMORY_CANDIDATE_CREATED'
  | 'SDD_STAGE_ADVANCED';

/** AgentProfile（§8：版本化，含 system instruction、输入输出 Schema、工具策略、上下文策略、模型能力要求、默认超时）。 */
export interface AgentProfileDefinition {
  systemInstruction: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  toolPolicy?: Record<string, unknown>;
  contextPolicy?: Record<string, unknown>;
  modelRequirements?: Record<string, unknown>;
  defaultTimeoutSeconds?: number;
}

export interface AgentProfile {
  id: string;
  revision: number;
  definition: AgentProfileDefinition;
  definitionHash: string;
  status: string;
  createdAt: string;
}

export interface Room {
  id: string;
  name: string;
  roomType: RoomType;
  manifest: Record<string, unknown>;
  manifestHash: string;
  status: RoomStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RoomProject {
  roomId: string;
  projectId: string;
  access: Record<string, unknown>;
}

export interface RoomTopic {
  id: string;
  roomId: string;
  title: string;
  status: string;
  createdAt: string;
  closedAt: string | null;
}

export interface RoomRun {
  id: string;
  roomId: string;
  topicId: string | null;
  protocolId: string;
  protocolVersion: string;
  snapshot: Record<string, unknown>;
  budget: Record<string, unknown>;
  usage: Record<string, unknown>;
  status: RoomRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  createdAt: string;
}

export interface RoomEvent {
  id: number;
  roomRunId: string;
  sequence: number;
  eventType: RoomEventType;
  actorRef: string;
  visibility: Record<string, unknown>;
  payload: Record<string, unknown>;
  payloadHash: string;
  createdAt: string;
}

/** 模型绑定快照（§16：Run override > AgentProfile > Room > Project > Global）。 */
export interface ModelBinding {
  modelProfileId: string;
  providerId?: string;
  /** 绑定的 ModelProfile 修订号（Run 创建时固定）。 */
  revision: number;
  /** Run 级覆盖（优先级最高）。 */
  override?: Record<string, unknown>;
}

/** 工具策略（§19 ROOM-SEC-001：权限为 Room/Project/AgentProfile/ToolPolicy 交集）。 */
export interface AgentToolPolicy {
  allowedTools: string[];
  deniedTools?: string[];
  /** 是否允许扩展权限（默认 false，扩展需人工批准）。 */
  allowPermissionExpansion?: boolean;
}

export interface AgentSession {
  id: string;
  roomRunId: string;
  participantId: string;
  agentProfileSnapshot: Record<string, unknown>;
  modelBinding: ModelBinding;
  toolPolicy: AgentToolPolicy;
  contextCursor: number;
  status: string;
  createdAt: string;
}

export interface RoomWorkItem {
  id: string;
  roomRunId: string;
  assigneeRef: string | null;
  kind: string;
  status: WorkItemStatus;
  inputRefs: string[];
  acceptance: Record<string, unknown>;
  outputRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoomDecision {
  id: string;
  roomRunId: string;
  decisionType: string;
  result: Record<string, unknown>;
  evidenceRefs: string[];
  dissent: Record<string, unknown>;
  status: string;
  approvalId: string | null;
  createdAt: string;
}

/** 协议限制（§12.3：maxTurns/maxDurationSeconds/maxTotalTokens/maxCost/noProgressTurns）。 */
export interface ProtocolLimits {
  maxTurns: number;
  maxDurationSeconds: number;
  maxTotalTokens: number;
  maxCost: number;
  noProgressTurns: number;
}

/** 协议定义（§5：sequential/concurrent/handoff/review）。 */
export interface ProtocolDefinition {
  id: string;
  version: string;
  limits: ProtocolLimits;
}

/** 预算使用（§21 可观测性）。 */
export interface BudgetUsage {
  turns: number;
  totalTokens: number;
  cost: number;
}

/** Handoff 交接包（§12.2）。 */
export interface Handoff {
  toParticipantId: string;
  workItemId: string;
  objective: string;
  inputRefs: string[];
  acceptance: string[];
  reason: string;
}

/** Rubric 维度（§15.2：权重 0-100，总权重必须 100）。 */
export interface RubricDimension {
  key: string;
  name: string;
  weight: number;
}

export interface Rubric {
  dimensions: RubricDimension[];
}

/** 单维度评分（§15.2：必须带证据引用，禁止只给总分）。 */
export interface DimensionScore {
  dimension: string;
  score: number;
  evidenceRefs: string[];
}

/** 评分票（§15.2：匿名候选 + 逐维评分）。 */
export interface Ballot {
  id: string;
  roomRunId: string;
  candidateId: string;
  ballotterId: string;
  dimensionScores: DimensionScore[];
  createdAt: string;
}
