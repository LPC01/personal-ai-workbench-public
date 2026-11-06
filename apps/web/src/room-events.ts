/**
 * RoomEvent 视觉分类（29 号 SPEC §18-2：消息流必须按事件类型区分）。
 * 只做展示分组，不改变事件语义；事件类型全集见 29 号 SPEC §10。
 */

export type RoomEventCategory = 'user' | 'agent' | 'tool' | 'evidence' | 'approval' | 'system';

export interface RoomEventCategoryMeta {
  label: string;
  color: string;
  bg: string;
  border: string;
}

/** 分类样式：语义不依赖单一颜色（同时有文字标签）。 */
export const EVENT_CATEGORY_META: Record<RoomEventCategory, RoomEventCategoryMeta> = {
  user: {
    label: '用户',
    color: 'var(--wb-text)',
    bg: 'var(--wb-surface-muted)',
    border: 'var(--wb-border-strong)',
  },
  agent: {
    label: 'Agent 消息',
    color: 'var(--wb-accent)',
    bg: 'var(--wb-accent-soft)',
    border: 'var(--wb-accent-strong)',
  },
  tool: {
    label: 'Tool/Run 事件',
    color: 'var(--wb-success)',
    bg: 'var(--wb-success-soft)',
    border: 'var(--wb-success-border)',
  },
  evidence: {
    label: '证据/阶段',
    color: 'var(--wb-warn)',
    bg: 'var(--wb-warn-soft)',
    border: 'var(--wb-warn-border)',
  },
  approval: {
    label: '人工审批',
    color: 'var(--wb-danger)',
    bg: 'var(--wb-danger-soft)',
    border: 'var(--wb-danger-border)',
  },
  system: {
    label: '系统',
    color: 'var(--wb-text-muted)',
    bg: 'var(--wb-surface-soft)',
    border: 'var(--wb-border)',
  },
};

const CATEGORY_BY_EVENT_TYPE: Record<string, RoomEventCategory> = {
  USER_MESSAGE: 'user',
  AGENT_MESSAGE: 'agent',
  AGENT_TURN_STARTED: 'agent',
  PROPOSAL_SUBMITTED: 'agent',
  CRITIQUE_SUBMITTED: 'agent',
  BALLOT_SUBMITTED: 'agent',
  DECISION_PROPOSED: 'agent',
  TOOL_CALL_REQUESTED: 'tool',
  TOOL_CALL_COMPLETED: 'tool',
  TASK_ASSIGNED: 'tool',
  HANDOFF_REQUESTED: 'tool',
  HANDOFF_COMPLETED: 'tool',
  ROOM_RUN_CREATED: 'tool',
  ROOM_RUN_PAUSED: 'tool',
  ROOM_RUN_RESUMED: 'tool',
  ROOM_RUN_COMPLETED: 'tool',
  EVIDENCE_ATTACHED: 'evidence',
  CONTEXT_SNAPSHOT_CREATED: 'evidence',
  MEMORY_CANDIDATE_CREATED: 'evidence',
  DECISION_RECORDED: 'evidence',
  SDD_STAGE_ADVANCED: 'evidence',
  APPROVAL_REQUESTED: 'approval',
  APPROVAL_RESOLVED: 'approval',
  BUDGET_WARNING: 'system',
};

export function eventCategory(eventType: string): RoomEventCategory {
  return CATEGORY_BY_EVENT_TYPE[eventType] ?? 'system';
}

/** 该事件是否属于「Tool/Run 事件」（供 Inspector 的 Tool Call 区块筛选）。 */
export function isToolCallEvent(eventType: string): boolean {
  return eventType === 'TOOL_CALL_REQUESTED' || eventType === 'TOOL_CALL_COMPLETED';
}

/** RoomRun 失败态（30 号基线禁止偏差：失败门不得显示为成功）。 */
export const FAILED_RUN_STATUSES: ReadonlySet<string> = new Set([
  'FAILED',
  'REJECTED',
  'CANCELLED',
  'TIMED_OUT',
  'BUDGET_EXCEEDED',
]);

/** 运行态（用于状态点颜色）。 */
export function runStatusTone(status: string): 'ok' | 'warn' | 'bad' | 'idle' {
  if (status === 'RUNNING' || status === 'SUCCEEDED') return 'ok';
  if (status === 'WAITING_APPROVAL' || status === 'WAITING_USER' || status === 'PAUSED')
    return 'warn';
  if (FAILED_RUN_STATUSES.has(status)) return 'bad';
  return 'idle';
}
