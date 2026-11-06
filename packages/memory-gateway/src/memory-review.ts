import { assertMemoryTransition, type MemoryStatus } from '@workbench/domain';
import type {
  MemoryCandidateFilter,
  MemoryCandidateRecord,
  MemoryCenterPort,
  MemoryCenterStatus,
  MemoryProvider,
  MemoryRef,
  MemoryScope,
} from '@workbench/contracts';
import { InMemoryMemoryCenterStore } from './in-memory-memory-center.js';
import { MemoryWriteGuard } from './secret-pii-scanner.js';

export interface ProposeOptions {
  /** 归属项目（跨项目隔离与 Candidate Inbox 过滤）。 */
  projectId?: string;
  /** 候选来源（房间 Run / Issue / 会话）。 */
  sourceUri?: string;
}

/**
 * Memory 审核服务（26 SPEC §9.3 + §14.3）：Candidate → Verified → Active。
 * 模型只能创建 Candidate；关键记忆必须批准后进入 Active（状态机校验 + Secret/PII 守卫）。
 *
 * 审核状态经 `MemoryCenterPort` **持久化**（默认内存实现，生产注入 SQLite 存储），
 * 因此重启后 Candidate Inbox 仍可恢复（known-limitations #6）。
 */
export class MemoryReviewService {
  private readonly provider: MemoryProvider;
  private readonly guard: MemoryWriteGuard;
  private readonly center: MemoryCenterPort;

  constructor(provider: MemoryProvider, guard?: MemoryWriteGuard, center?: MemoryCenterPort) {
    this.provider = provider;
    this.guard = guard ?? new MemoryWriteGuard();
    this.center = center ?? new InMemoryMemoryCenterStore();
  }

  private persist(record: MemoryCandidateRecord): void {
    this.center.saveCandidate(record);
  }

  /** 提议候选（Secret/PII 守卫 → CANDIDATE）。 */
  async propose(
    content: string,
    scope: MemoryScope,
    options: ProposeOptions = {},
  ): Promise<MemoryRef> {
    this.guard.assertWritable(content);
    const ref = await this.provider.createCandidate({
      content,
      scope,
      sourceUri: options.sourceUri,
    });
    const now = new Date().toISOString();
    this.persist({
      uri: ref.uri,
      projectId: options.projectId ?? null,
      scope,
      content,
      status: 'CANDIDATE',
      sourceUri: options.sourceUri ?? null,
      supersededBy: null,
      createdAt: now,
      updatedAt: now,
    });
    return ref;
  }

  /** 审核验证：CANDIDATE → VERIFIED。 */
  verify(ref: MemoryRef): void {
    this.transition(ref, 'VERIFIED');
  }

  /** 激活：VERIFIED → ACTIVE（写入 provider）。 */
  async activate(ref: MemoryRef): Promise<void> {
    this.transition(ref, 'ACTIVE');
    await this.provider.activate(ref);
  }

  /** 废止候选：CANDIDATE/VERIFIED/ACTIVE → SUPERSEDED（可指定取代者）。 */
  supersede(ref: MemoryRef, by?: MemoryRef): void {
    const patch = by ? { supersededBy: by.uri } : undefined;
    this.transition(ref, 'SUPERSEDED', patch);
  }

  /** 撤销：ACTIVE → REVOKED（写入 provider，默认过滤不召回）。 */
  async revoke(ref: MemoryRef): Promise<void> {
    this.transition(ref, 'REVOKED', undefined, 'ACTIVE');
    await this.provider.revoke(ref);
  }

  status(ref: MemoryRef): MemoryStatus | undefined {
    return this.center.getCandidate(ref.uri)?.status;
  }

  /** Candidate Inbox / Superseded 列表数据源。 */
  listCandidates(filter: MemoryCandidateFilter = {}): MemoryCandidateRecord[] {
    return this.center.listCandidates(filter);
  }

  /** 状态机校验 + 落地到投影存储。 */
  private transition(
    ref: MemoryRef,
    to: MemoryCenterStatus,
    patch?: { supersededBy?: string },
    defaultFrom: MemoryCenterStatus = 'CANDIDATE',
  ): void {
    const current = this.center.getCandidate(ref.uri);
    const from: MemoryCenterStatus = current?.status ?? defaultFrom;
    assertMemoryTransition(from, to);
    const now = new Date().toISOString();
    this.persist({
      uri: ref.uri,
      projectId: current?.projectId ?? null,
      scope: current?.scope ?? 'project',
      content: current?.content ?? '',
      status: to,
      sourceUri: current?.sourceUri ?? null,
      supersededBy: patch?.supersededBy ?? current?.supersededBy ?? null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });
  }
}
