import { describe, expect, it } from 'vitest';
import {
  assertMemoryTransition,
  canTransitionMemory,
  isRecallableMemoryStatus,
} from '../memory-state.js';
import { assertIssueTransition, canTransitionIssue } from '../issue-state.js';

describe('Memory 状态机（§9.3）', () => {
  it('RAW→CANDIDATE→VERIFIED→ACTIVE 合法', () => {
    expect(canTransitionMemory('RAW', 'CANDIDATE')).toBe(true);
    expect(canTransitionMemory('CANDIDATE', 'VERIFIED')).toBe(true);
    expect(canTransitionMemory('VERIFIED', 'ACTIVE')).toBe(true);
  });

  it('ACTIVE→SUPERSEDED/REVOKED 合法', () => {
    expect(canTransitionMemory('ACTIVE', 'SUPERSEDED')).toBe(true);
    expect(canTransitionMemory('ACTIVE', 'REVOKED')).toBe(true);
  });

  it('RAW 不可直接到 ACTIVE（须经审核）', () => {
    expect(canTransitionMemory('RAW', 'ACTIVE')).toBe(false);
    expect(() => assertMemoryTransition('RAW', 'ACTIVE')).toThrow();
  });

  it('终态不可再转换', () => {
    expect(canTransitionMemory('SUPERSEDED', 'ACTIVE')).toBe(false);
    expect(canTransitionMemory('REVOKED', 'ACTIVE')).toBe(false);
  });

  it('isRecallableMemoryStatus：VERIFIED/ACTIVE 可召回', () => {
    expect(isRecallableMemoryStatus('VERIFIED')).toBe(true);
    expect(isRecallableMemoryStatus('ACTIVE')).toBe(true);
    expect(isRecallableMemoryStatus('SUPERSEDED')).toBe(false);
  });
});

describe('Issue 状态机（§6.11）', () => {
  it('OPEN→RESOLVED→VERIFIED 合法', () => {
    expect(canTransitionIssue('OPEN', 'RESOLVED')).toBe(true);
    expect(canTransitionIssue('RESOLVED', 'VERIFIED')).toBe(true);
  });

  it('RESOLVED 可回退 OPEN', () => {
    expect(canTransitionIssue('RESOLVED', 'OPEN')).toBe(true);
  });

  it('VERIFIED 终态不可再转换', () => {
    expect(canTransitionIssue('VERIFIED', 'OPEN')).toBe(false);
    expect(() => assertIssueTransition('VERIFIED', 'OPEN')).toThrow();
  });
});
