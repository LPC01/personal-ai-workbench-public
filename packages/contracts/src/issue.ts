/**
 * Issue 与 Evidence 契约（25 设计 §6.11：Issue → Resolution → Verification → Lesson）。
 * 状态值与 domain 的 IssueStatus 对齐。
 */

/** Issue 状态。 */
export type IssueStatus = 'OPEN' | 'RESOLVED' | 'VERIFIED' | 'LESSON';

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  projectId?: string;
  extensionId?: string;
  createdAt: string;
  updatedAt: string;
}

/** 证据类型（关联 Run/Artifact/日志/测试）。 */
export type EvidenceKind = 'run' | 'artifact' | 'log' | 'test';

/** 证据引用（URI 指向 Run/Artifact/日志/测试）。 */
export interface Evidence {
  id: string;
  issueId: string;
  kind: EvidenceKind;
  uri: string;
  createdAt: string;
}
