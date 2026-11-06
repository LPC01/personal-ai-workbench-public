import { describe, expect, it } from 'vitest';
import {
  assertRunTransition,
  canTransitionRun,
  isTerminalRunStatus,
  resolveCancelStatus,
  RUN_TERMINAL_STATUSES,
  RUN_TRANSITIONS,
  type RunStatus,
} from '../run.js';

describe('Run 状态机（26 SPEC §9.1）', () => {
  it('转换表与 §9.1 完全一致', () => {
    expect(RUN_TRANSITIONS).toEqual({
      CREATED: ['VALIDATING'],
      VALIDATING: ['QUEUED', 'FAILED'],
      QUEUED: ['STARTING', 'CANCELLED'],
      STARTING: ['RUNNING', 'FAILED', 'UNKNOWN'],
      RUNNING: ['WAITING_USER', 'CANCELLING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'],
      WAITING_USER: ['RUNNING', 'CANCELLING', 'FAILED'],
      CANCELLING: ['CANCELLED', 'FAILED', 'UNKNOWN'],
      UNKNOWN: ['RECONCILING'],
      RECONCILING: ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
      CANCELLED: [],
      SUCCEEDED: [],
      FAILED: [],
    });
  });

  it('终态为 SUCCEEDED/FAILED/CANCELLED', () => {
    expect(RUN_TERMINAL_STATUSES).toEqual(['SUCCEEDED', 'FAILED', 'CANCELLED']);
    expect(isTerminalRunStatus('SUCCEEDED')).toBe(true);
    expect(isTerminalRunStatus('FAILED')).toBe(true);
    expect(isTerminalRunStatus('CANCELLED')).toBe(true);
    expect(isTerminalRunStatus('RUNNING')).toBe(false);
    expect(isTerminalRunStatus('CREATED')).toBe(false);
  });

  it('合法转换返回 true', () => {
    expect(canTransitionRun('CREATED', 'VALIDATING')).toBe(true);
    expect(canTransitionRun('RUNNING', 'SUCCEEDED')).toBe(true);
    expect(canTransitionRun('UNKNOWN', 'RECONCILING')).toBe(true);
  });

  it('非法转换返回 false', () => {
    expect(canTransitionRun('CREATED', 'RUNNING')).toBe(false);
    expect(canTransitionRun('SUCCEEDED', 'RUNNING')).toBe(false);
    expect(canTransitionRun('RUNNING', 'CREATED')).toBe(false);
  });

  it('非法转换抛 RUN_STATE_CONFLICT', () => {
    expect(() => assertRunTransition('SUCCEEDED', 'RUNNING')).toThrowError(
      expect.objectContaining({ code: 'RUN_STATE_CONFLICT' }),
    );
    expect(() => assertRunTransition('CREATED', 'SUCCEEDED')).toThrowError(
      expect.objectContaining({ code: 'RUN_STATE_CONFLICT' }),
    );
  });

  it('终态不得返回非终态（覆盖所有终态）', () => {
    for (const terminal of RUN_TERMINAL_STATUSES) {
      for (const nonTerminal of Object.keys(RUN_TRANSITIONS) as RunStatus[]) {
        if (!isTerminalRunStatus(nonTerminal)) {
          expect(canTransitionRun(terminal, nonTerminal)).toBe(false);
        }
      }
    }
  });
});

describe('resolveCancelStatus（取消策略）', () => {
  it('QUEUED 直接取消到 CANCELLED', () => {
    expect(resolveCancelStatus('QUEUED')).toBe('CANCELLED');
  });

  it('RUNNING / WAITING_USER 进入 CANCELLING', () => {
    expect(resolveCancelStatus('RUNNING')).toBe('CANCELLING');
    expect(resolveCancelStatus('WAITING_USER')).toBe('CANCELLING');
  });

  it('CANCELLING 幂等返回 CANCELLING', () => {
    expect(resolveCancelStatus('CANCELLING')).toBe('CANCELLING');
  });

  it('终态 / UNKNOWN / RECONCILING 不可取消', () => {
    expect(resolveCancelStatus('SUCCEEDED')).toBeNull();
    expect(resolveCancelStatus('FAILED')).toBeNull();
    expect(resolveCancelStatus('CANCELLED')).toBeNull();
    expect(resolveCancelStatus('UNKNOWN')).toBeNull();
    expect(resolveCancelStatus('RECONCILING')).toBeNull();
    expect(resolveCancelStatus('CREATED')).toBeNull();
    expect(resolveCancelStatus('VALIDATING')).toBeNull();
  });
});
