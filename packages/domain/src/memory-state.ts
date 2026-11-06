import { AppError } from './errors.js';

/**
 * Memory 状态机（26 SPEC §9.3）：
 * `RAW → CANDIDATE → VERIFIED → ACTIVE → SUPERSEDED | REVOKED`。
 * 模型只能创建 Candidate；关键记忆必须由用户或策略引擎批准后进入 Active。
 */
export type MemoryStatus = 'RAW' | 'CANDIDATE' | 'VERIFIED' | 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';

export const MEMORY_TRANSITIONS: Readonly<Record<MemoryStatus, readonly MemoryStatus[]>> = {
  RAW: ['CANDIDATE'],
  CANDIDATE: ['VERIFIED', 'SUPERSEDED'],
  VERIFIED: ['ACTIVE', 'SUPERSEDED'],
  ACTIVE: ['SUPERSEDED', 'REVOKED'],
  SUPERSEDED: [],
  REVOKED: [],
};

/** 是否为可召回状态（SUPERSEDED/REVOKED 默认不注入）。 */
export function isRecallableMemoryStatus(status: MemoryStatus): boolean {
  return status === 'VERIFIED' || status === 'ACTIVE';
}

export function canTransitionMemory(from: MemoryStatus, to: MemoryStatus): boolean {
  const allowed = MEMORY_TRANSITIONS[from];
  return allowed !== undefined && (allowed as readonly string[]).includes(to);
}

export function assertMemoryTransition(from: MemoryStatus, to: MemoryStatus): void {
  if (!canTransitionMemory(from, to)) {
    throw new AppError('RUN_STATE_CONFLICT', `非法 Memory 状态转换: ${from} -> ${to}`, {
      details: { from, to },
    });
  }
}
