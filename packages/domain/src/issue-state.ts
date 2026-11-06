import { AppError } from './errors.js';

/**
 * Issue 状态机（25 设计 §6.11：Issue → Resolution → Verification → Lesson）。
 */
export type IssueStatus = 'OPEN' | 'RESOLVED' | 'VERIFIED' | 'LESSON';

export const ISSUE_TRANSITIONS: Readonly<Record<IssueStatus, readonly IssueStatus[]>> = {
  OPEN: ['RESOLVED'],
  RESOLVED: ['VERIFIED', 'OPEN'],
  VERIFIED: ['LESSON'],
  LESSON: [],
};

export function canTransitionIssue(from: IssueStatus, to: IssueStatus): boolean {
  const allowed = ISSUE_TRANSITIONS[from];
  return allowed !== undefined && (allowed as readonly string[]).includes(to);
}

export function assertIssueTransition(from: IssueStatus, to: IssueStatus): void {
  if (!canTransitionIssue(from, to)) {
    throw new AppError('RUN_STATE_CONFLICT', `非法 Issue 状态转换: ${from} -> ${to}`, {
      details: { from, to },
    });
  }
}
