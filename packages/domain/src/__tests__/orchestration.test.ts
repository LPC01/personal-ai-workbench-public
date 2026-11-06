import { describe, expect, it } from 'vitest';
import {
  ROOM_RUN_TERMINAL,
  assertParticipantAllowed,
  assertRoomRunTransition,
  canTransitionRoomRun,
  checkBudget,
  isNoProgress,
  validateHandoff,
  type BudgetLimits,
} from '../orchestration.js';

const LIMITS: BudgetLimits = {
  maxTurns: 10,
  maxDurationSeconds: 3600,
  maxTotalTokens: 1000,
  maxCost: 5,
  noProgressTurns: 3,
};

describe('RoomRun 状态转换（§9.2）', () => {
  it('合法转换通过，非法转换抛错', () => {
    expect(canTransitionRoomRun('CREATED', 'VALIDATING')).toBe(true);
    expect(canTransitionRoomRun('RUNNING', 'PAUSED')).toBe(true);
    expect(canTransitionRoomRun('PAUSED', 'RUNNING')).toBe(true);
    expect(canTransitionRoomRun('RUNNING', 'SUCCEEDED')).toBe(true);
    expect(canTransitionRoomRun('RUNNING', 'CANCELLING')).toBe(true);
    expect(canTransitionRoomRun('CANCELLING', 'CANCELLED')).toBe(true);

    expect(canTransitionRoomRun('CREATED', 'RUNNING')).toBe(false);
    expect(canTransitionRoomRun('PAUSED', 'SUCCEEDED')).toBe(false);
    expect(() => assertRoomRunTransition('CREATED', 'RUNNING')).toThrow(/不允许/);
  });

  it('终态不可逆', () => {
    for (const terminal of ROOM_RUN_TERMINAL) {
      expect(canTransitionRoomRun(terminal as never, 'RUNNING')).toBe(false);
    }
  });
});

describe('checkBudget（§12.3 硬预算）', () => {
  it('未超限返回 null', () => {
    expect(checkBudget(LIMITS, { turns: 5, totalTokens: 500, cost: 2 }, 100)).toBeNull();
  });

  it('各项超限返回对应类型', () => {
    expect(checkBudget(LIMITS, { turns: 10, totalTokens: 0, cost: 0 }, 0)).toBe('turns');
    expect(checkBudget(LIMITS, { turns: 0, totalTokens: 1000, cost: 0 }, 0)).toBe('tokens');
    expect(checkBudget(LIMITS, { turns: 0, totalTokens: 0, cost: 5 }, 0)).toBe('cost');
    expect(checkBudget(LIMITS, { turns: 0, totalTokens: 0, cost: 0 }, 3600)).toBe('duration');
  });

  it('无进展检测', () => {
    expect(isNoProgress(3, LIMITS)).toBe(true);
    expect(isNoProgress(2, LIMITS)).toBe(false);
  });
});

describe('validateHandoff（§12.2）', () => {
  const allowed = new Set(['builder', 'reviewer']);
  const base = {
    toParticipantId: 'builder',
    workItemId: 'wi_1',
    objective: '实现 Spec',
    inputRefs: ['artifact://spec'],
    acceptance: ['tests pass'],
    reason: 'Spec 已批准',
  };

  it('合法目标通过', () => {
    expect(validateHandoff(base, allowed)).toBeNull();
  });

  it('目标不在允许集合拒绝', () => {
    expect(validateHandoff({ ...base, toParticipantId: 'judge' }, allowed)).toMatch(/不在允许集合/);
  });

  it('缺少字段拒绝', () => {
    expect(validateHandoff({ ...base, workItemId: '' }, allowed)).toMatch(/workItemId/);
    expect(validateHandoff({ ...base, objective: '' }, allowed)).toMatch(/objective/);
  });
});

describe('assertParticipantAllowed（§12.1 候选集合）', () => {
  it('允许集合内通过，否则抛错', () => {
    const allowed = new Set(['designer', 'builder']);
    expect(() => assertParticipantAllowed('designer', allowed)).not.toThrow();
    expect(() => assertParticipantAllowed('intruder', allowed)).toThrow(/不在允许集合/);
  });
});
