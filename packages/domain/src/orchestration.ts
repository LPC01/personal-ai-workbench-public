/**
 * 多智能体编排纯逻辑（29 号 SPEC §9.2 状态机 + §12 编排/Handoff/终止 + §21 预算）。
 * domain 包保持纯净，不依赖 contracts；类型与 contracts 结构兼容。
 */

/** RoomRun 状态（结构兼容 contracts.RoomRunStatus）。 */
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
export const ROOM_RUN_TERMINAL: ReadonlySet<RoomRunStatus> = new Set([
  'SUCCEEDED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
  'TIMED_OUT',
  'BUDGET_EXCEEDED',
]);

/** RoomRun 状态转换表（§9.2）。 */
export const ROOM_RUN_TRANSITIONS: ReadonlyMap<RoomRunStatus, ReadonlySet<RoomRunStatus>> = new Map<
  RoomRunStatus,
  ReadonlySet<RoomRunStatus>
>([
  ['CREATED', new Set(['VALIDATING'])],
  ['VALIDATING', new Set(['READY', 'FAILED'])],
  ['READY', new Set(['RUNNING', 'CANCELLED'])],
  [
    'RUNNING',
    new Set([
      'WAITING_AGENT',
      'WAITING_USER',
      'WAITING_APPROVAL',
      'PAUSED',
      'SUCCEEDED',
      'FAILED',
      'CANCELLING',
      'BUDGET_EXCEEDED',
    ]),
  ],
  ['WAITING_AGENT', new Set(['RUNNING', 'FAILED', 'TIMED_OUT'])],
  ['WAITING_USER', new Set(['RUNNING', 'CANCELLED', 'TIMED_OUT'])],
  ['WAITING_APPROVAL', new Set(['RUNNING', 'REJECTED', 'TIMED_OUT'])],
  ['PAUSED', new Set(['RUNNING', 'CANCELLED'])],
  ['CANCELLING', new Set(['CANCELLED', 'FAILED'])],
]);

export function canTransitionRoomRun(from: RoomRunStatus, to: RoomRunStatus): boolean {
  return ROOM_RUN_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertRoomRunTransition(from: RoomRunStatus, to: RoomRunStatus): void {
  if (!canTransitionRoomRun(from, to)) {
    throw new Error(`RoomRun 状态不允许从 ${from} 转换到 ${to}`);
  }
}

/** 预算限制（结构兼容 contracts.ProtocolLimits）。 */
export interface BudgetLimits {
  maxTurns: number;
  maxDurationSeconds: number;
  maxTotalTokens: number;
  maxCost: number;
  noProgressTurns: number;
}

/** 预算使用（结构兼容 contracts.BudgetUsage）。 */
export interface BudgetUsage {
  turns: number;
  totalTokens: number;
  cost: number;
}

/** 硬预算超限类型。 */
export type BudgetExceededReason = 'turns' | 'duration' | 'tokens' | 'cost';

/** 检查硬预算（§12.3）：任一硬上限达到则返回超限类型，否则 null。 */
export function checkBudget(
  limits: BudgetLimits,
  usage: BudgetUsage,
  elapsedSeconds: number,
): BudgetExceededReason | null {
  if (usage.turns >= limits.maxTurns) return 'turns';
  if (elapsedSeconds >= limits.maxDurationSeconds) return 'duration';
  if (usage.totalTokens >= limits.maxTotalTokens) return 'tokens';
  if (usage.cost >= limits.maxCost) return 'cost';
  return null;
}

/**
 * 无进展检测（§12.3）：连续 noProgressTurns 轮无实质产出（WorkItem 状态变化/Proposal/
 * Evidence/Decision/Artifact）视为无进展，返回 true。
 */
export function isNoProgress(noProgressTurns: number, limits: BudgetLimits): boolean {
  return noProgressTurns >= limits.noProgressTurns;
}

/** Handoff 交接包（结构兼容 contracts.Handoff）。 */
export interface HandoffInput {
  toParticipantId: string;
  workItemId: string;
  objective: string;
  inputRefs: string[];
  acceptance: string[];
  reason: string;
}

/** 校验 Handoff（§12.2）：目标必须在允许集合，交接包字段完整。返回错误信息或 null。 */
export function validateHandoff(
  handoff: HandoffInput,
  allowedParticipants: ReadonlySet<string>,
): string | null {
  if (!handoff.toParticipantId) return 'Handoff 缺少 toParticipantId';
  if (!allowedParticipants.has(handoff.toParticipantId)) {
    return `Handoff 目标 ${handoff.toParticipantId} 不在允许集合`;
  }
  if (!handoff.workItemId) return 'Handoff 缺少 workItemId';
  if (!handoff.objective) return 'Handoff 缺少 objective';
  if (!Array.isArray(handoff.inputRefs)) return 'Handoff inputRefs 必须为数组';
  if (!Array.isArray(handoff.acceptance)) return 'Handoff acceptance 必须为数组';
  return null;
}

/** 断言参与者属于允许集合（§12.1 候选集合检查）。 */
export function assertParticipantAllowed(
  participantId: string,
  allowedParticipants: ReadonlySet<string>,
): void {
  if (!allowedParticipants.has(participantId)) {
    throw new Error(`参与者 ${participantId} 不在允许集合`);
  }
}
