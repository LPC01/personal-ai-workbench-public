import { randomUUID } from 'node:crypto';
import type {
  CandidateInput,
  ExportBundle,
  MemoryDocument,
  MemoryHealth,
  MemoryHit,
  MemoryProvider,
  MemoryQuery,
  MemoryRef,
  MemoryScope,
  ResourceInput,
  ResourceRef,
} from '@workbench/contracts';

interface StoredDocument {
  uri: string;
  content: string;
  scope: MemoryScope;
  supersededBy?: string;
  revoked?: boolean;
}

/**
 * 最小内存降级实现（26 SPEC §14.1：必须提供最小 Markdown/SQLite 降级实现）。
 * 用于测试与 OpenViking 不可用时的本地降级。
 */
export class InMemoryMemoryProvider implements MemoryProvider {
  private readonly docs = new Map<string, StoredDocument>();
  private readonly candidates = new Map<
    string,
    { content: string; scope: MemoryScope; sourceUri?: string }
  >();

  async health(): Promise<MemoryHealth> {
    return { status: 'READY_READWRITE', ok: true };
  }

  async indexResource(input: ResourceInput): Promise<ResourceRef> {
    this.docs.set(input.uri, {
      uri: input.uri,
      content: input.content,
      scope: input.scope ?? 'project',
    });
    return { uri: input.uri };
  }

  async search(query: MemoryQuery): Promise<MemoryHit[]> {
    const term = query.query.toLowerCase();
    const limit = query.limit ?? 10;
    const hits: MemoryHit[] = [];
    for (const doc of this.docs.values()) {
      if (doc.revoked || doc.supersededBy) {
        continue;
      }
      if (query.scope && doc.scope !== query.scope) {
        continue;
      }
      const idx = doc.content.toLowerCase().indexOf(term);
      if (idx >= 0) {
        hits.push({
          uri: doc.uri,
          score: 1 / (idx + 1),
          snippet: doc.content.slice(0, 120),
        });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async read(uri: string): Promise<MemoryDocument> {
    const doc = this.docs.get(uri);
    if (!doc) {
      throw new Error(`Memory 文档不存在: ${uri}`);
    }
    return { uri: doc.uri, content: doc.content, scope: doc.scope };
  }

  async createCandidate(input: CandidateInput): Promise<MemoryRef> {
    // uri 必须唯一：`activate` 会从 candidates 中移除条目，若用 size 计数会复用旧 uri，
    // 使后来者覆盖前者的审核状态（记忆中心按 uri 为唯一键）。
    const uri = `mem-cand-${randomUUID()}`;
    this.candidates.set(uri, {
      content: input.content,
      scope: input.scope,
      sourceUri: input.sourceUri,
    });
    return { uri };
  }

  async activate(ref: MemoryRef): Promise<void> {
    const cand = this.candidates.get(ref.uri);
    if (!cand) {
      throw new Error(`候选不存在: ${ref.uri}`);
    }
    this.docs.set(ref.uri, { uri: ref.uri, content: cand.content, scope: cand.scope });
    this.candidates.delete(ref.uri);
  }

  async supersede(oldRef: MemoryRef, newRef: MemoryRef): Promise<void> {
    const old = this.docs.get(oldRef.uri);
    if (old) {
      old.supersededBy = newRef.uri;
    }
  }

  async revoke(ref: MemoryRef): Promise<void> {
    const doc = this.docs.get(ref.uri);
    if (doc) {
      doc.revoked = true;
    }
  }

  async export(scope: MemoryScope): Promise<ExportBundle> {
    const documents: MemoryDocument[] = [];
    for (const doc of this.docs.values()) {
      if (doc.scope === scope && !doc.revoked) {
        documents.push({ uri: doc.uri, content: doc.content, scope: doc.scope });
      }
    }
    return { scope, documents };
  }
}
