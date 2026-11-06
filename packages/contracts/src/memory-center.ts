/**
 * 记忆中心端口与记录（25 设计「记忆中心」子树 / 26 SPEC §14）。
 *
 * 这是**工作台侧投影存储**的契约：把「候选审核状态 / 已导入资源 / 召回审计」持久化，
 * 使 `#/memory` 可枚举、重启可恢复。
 *
 * 它**不改变** `MemoryProvider` 契约 —— Provider 仍只负责 health/index/search/read/
 * 候选写入/导出；枚举与状态持久化由本端口承接（避免要求 Provider 具备 OpenViking
 * 未必支持的列表能力）。
 */
import type { MemoryScope } from './memory.js';

/** 记忆中心记录的审核状态（`@workbench/domain` 的 `MemoryStatus` 子集，去掉 `RAW`）。 */
export type MemoryCenterStatus = 'CANDIDATE' | 'VERIFIED' | 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';

/** 候选/记忆条目的投影记录（Candidate Inbox / Superseded 列表的数据源）。 */
export interface MemoryCandidateRecord {
  uri: string;
  projectId: string | null;
  scope: MemoryScope;
  content: string;
  status: MemoryCenterStatus;
  sourceUri: string | null;
  /** 被哪个 uri 取代（SUPERSEDED 时非空）。 */
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 已导入资源的投影记录（全量 Resources 列表的数据源）。 */
export interface MemoryResourceRecord {
  uri: string;
  projectId: string;
  name: string;
  sensitivity: 'public' | 'internal' | 'confidential';
  sourceHash: string | null;
  createdAt: string;
}

/** 召回审计记录（26 SPEC §14.2：查询、作用域、命中 URI、token、注入位置）。 */
export interface RecallAuditRecord {
  id: string;
  projectId: string | null;
  query: string;
  scope: MemoryScope;
  hitUris: string[];
  totalTokens: number;
  budgetTokens: number;
  injectedPosition: 'context';
  createdAt: string;
}

export interface MemoryCandidateFilter {
  projectId?: string;
  statuses?: MemoryCenterStatus[];
}

export interface MemoryResourceFilter {
  projectId?: string;
}

export interface RecallAuditFilter {
  projectId?: string;
  limit?: number;
}

/**
 * 记忆中心持久化端口。
 * 实现位于 `@workbench/persistence`（SQLite）与 `@workbench/memory-gateway`（内存，供测试）。
 */
export interface MemoryCenterPort {
  /** 新增或覆盖候选记录。 */
  saveCandidate(record: MemoryCandidateRecord): void;
  getCandidate(uri: string): MemoryCandidateRecord | undefined;
  listCandidates(filter?: MemoryCandidateFilter): MemoryCandidateRecord[];
  /** 记录一次只读资源导入。 */
  recordResource(record: MemoryResourceRecord): void;
  listResources(filter?: MemoryResourceFilter): MemoryResourceRecord[];
  /** 追加一条召回审计。 */
  appendRecallAudit(record: RecallAuditRecord): void;
  listRecallAudits(filter?: RecallAuditFilter): RecallAuditRecord[];
}
