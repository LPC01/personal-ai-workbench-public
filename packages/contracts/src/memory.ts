/**
 * Memory Gateway 契约（26 SPEC §14）。
 * OpenViking Adapter 必须是实现之一；还必须提供最小 Markdown/SQLite 降级实现或明确的只读降级。
 */

/** 记忆作用域（25 设计 §11.2）。 */
export type MemoryScope = 'user' | 'project' | 'extension' | 'run';

/** Memory 健康状态（32 号 SPEC §4.2）：区分不可用、降级、只读就绪、读写就绪。 */
export type MemoryHealthStatus = 'UNAVAILABLE' | 'DEGRADED' | 'READY_READONLY' | 'READY_READWRITE';

export interface MemoryHealth {
  status: MemoryHealthStatus;
  /** READY_* 为 true；UNAVAILABLE/DEGRADED 为 false。 */
  ok: boolean;
  detail?: string;
}

export interface ResourceInput {
  uri: string;
  content: string;
  scope?: MemoryScope;
  /** 来源哈希：相同 uri+hash 幂等（32 号 SPEC §4.3）。 */
  sourceHash?: string;
  /** 敏感级别（32 号 SPEC §4.3）。 */
  sensitivity?: 'public' | 'internal' | 'confidential';
  /** 来源引用（文件/会话/提交）。 */
  sourceRefs?: string[];
}

export interface ResourceRef {
  uri: string;
}

export interface MemoryQuery {
  query: string;
  scope?: MemoryScope;
  /** 项目隔离（32 号 SPEC §4.4：默认只检索当前项目）。 */
  projectId?: string;
  limit?: number;
  /** 最低语义分数，低于则不召回。 */
  minimumScore?: number;
  /** 排除的状态（如 superseded/revoked）。 */
  excludedStatus?: string[];
}

export interface MemoryHit {
  uri: string;
  score: number;
  snippet?: string;
}

export interface MemoryDocument {
  uri: string;
  content: string;
  scope: MemoryScope;
}

export interface CandidateInput {
  content: string;
  scope: MemoryScope;
  sourceUri?: string;
}

export interface MemoryRef {
  uri: string;
}

export interface ExportBundle {
  scope: MemoryScope;
  documents: MemoryDocument[];
}

/** MemoryProvider 接口（26 SPEC §14.1）。 */
export interface MemoryProvider {
  health(): Promise<MemoryHealth>;
  indexResource(input: ResourceInput): Promise<ResourceRef>;
  search(query: MemoryQuery): Promise<MemoryHit[]>;
  read(uri: string): Promise<MemoryDocument>;
  createCandidate(input: CandidateInput): Promise<MemoryRef>;
  activate(ref: MemoryRef): Promise<void>;
  supersede(oldRef: MemoryRef, newRef: MemoryRef): Promise<void>;
  /** 撤销（Revoked 默认不得注入，§14.2）。 */
  revoke(ref: MemoryRef): Promise<void>;
  export(scope: MemoryScope): Promise<ExportBundle>;
}
