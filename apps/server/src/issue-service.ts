import { AppError, assertIssueTransition } from '@workbench/domain';
import type { Evidence, Issue } from '@workbench/contracts';
import type { IssueStore } from '@workbench/persistence';
import type { MemoryReviewService } from '@workbench/memory-gateway';

/**
 * Issue 服务（25 设计 §6.11：Issue → Resolution → Verification → Lesson）。
 * 状态转换经状态机校验；晋升 Lesson 时写入 Memory（Candidate→Verified→Active）。
 */
export class IssueService {
  constructor(
    private readonly store: IssueStore,
    private readonly memory?: MemoryReviewService,
  ) {}

  createIssue(title: string, description: string): Issue {
    return this.store.createIssue({ title, description });
  }

  listIssues(): Issue[] {
    return this.store.listIssues();
  }

  addEvidence(issueId: string, kind: Evidence['kind'], uri: string): Evidence {
    this.requireIssue(issueId);
    return this.store.addEvidence(issueId, kind, uri);
  }

  listEvidence(issueId: string): Evidence[] {
    this.requireIssue(issueId);
    return this.store.listEvidence(issueId);
  }

  /** 解决：OPEN → RESOLVED。 */
  resolve(issueId: string): Issue {
    const issue = this.requireIssue(issueId);
    assertIssueTransition(issue.status, 'RESOLVED');
    return this.store.updateStatus(issueId, 'RESOLVED');
  }

  /** 验证：RESOLVED → VERIFIED。 */
  verify(issueId: string): Issue {
    const issue = this.requireIssue(issueId);
    assertIssueTransition(issue.status, 'VERIFIED');
    return this.store.updateStatus(issueId, 'VERIFIED');
  }

  /** 晋升 Lesson：要求已 VERIFIED，写入 Memory（Candidate→Verified→Active），状态 → LESSON。 */
  async promoteToLesson(issueId: string): Promise<Issue> {
    const issue = this.requireIssue(issueId);
    assertIssueTransition(issue.status, 'LESSON');
    if (this.memory) {
      const ref = await this.memory.propose(
        `Lesson: ${issue.title}\n${issue.description}`,
        'project',
      );
      this.memory.verify(ref);
      await this.memory.activate(ref);
    }
    return this.store.updateStatus(issueId, 'LESSON');
  }

  private requireIssue(issueId: string): Issue {
    const issue = this.store.getIssue(issueId);
    if (!issue) {
      throw new AppError('ISSUE_NOT_FOUND', 'Issue 不存在', { details: { issueId } });
    }
    return issue;
  }
}
