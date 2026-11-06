import type {
  MemoryCandidateFilter,
  MemoryCandidateRecord,
  MemoryCenterPort,
  MemoryResourceFilter,
  MemoryResourceRecord,
  RecallAuditFilter,
  RecallAuditRecord,
} from '@workbench/contracts';

/**
 * 记忆中心端口的内存实现（测试与非 Windows 环境使用）。
 * 语义与 `@workbench/persistence` 的 `MemoryCenterStore` 对齐：候选按 uri upsert、列表倒序。
 */
export class InMemoryMemoryCenterStore implements MemoryCenterPort {
  private readonly candidates = new Map<string, MemoryCandidateRecord>();
  private readonly resources = new Map<string, MemoryResourceRecord>();
  private readonly audits: RecallAuditRecord[] = [];

  saveCandidate(record: MemoryCandidateRecord): void {
    this.candidates.set(record.uri, { ...record });
  }

  getCandidate(uri: string): MemoryCandidateRecord | undefined {
    const found = this.candidates.get(uri);
    return found ? { ...found } : undefined;
  }

  listCandidates(filter: MemoryCandidateFilter = {}): MemoryCandidateRecord[] {
    return [...this.candidates.values()]
      .filter((c) => filter.projectId === undefined || c.projectId === filter.projectId)
      .filter(
        (c) =>
          !filter.statuses || filter.statuses.length === 0 || filter.statuses.includes(c.status),
      )
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .map((c) => ({ ...c }));
  }

  recordResource(record: MemoryResourceRecord): void {
    const prev = this.resources.get(record.uri);
    this.resources.set(record.uri, { ...record, createdAt: prev?.createdAt ?? record.createdAt });
  }

  listResources(filter: MemoryResourceFilter = {}): MemoryResourceRecord[] {
    return [...this.resources.values()]
      .filter((r) => filter.projectId === undefined || r.projectId === filter.projectId)
      .map((r) => ({ ...r }));
  }

  appendRecallAudit(record: RecallAuditRecord): void {
    this.audits.push({ ...record });
  }

  listRecallAudits(filter: RecallAuditFilter = {}): RecallAuditRecord[] {
    const filtered = this.audits
      .filter((a) => filter.projectId === undefined || a.projectId === filter.projectId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const limited = filter.limit !== undefined ? filtered.slice(0, filter.limit) : filtered;
    return limited.map((a) => ({ ...a }));
  }
}
