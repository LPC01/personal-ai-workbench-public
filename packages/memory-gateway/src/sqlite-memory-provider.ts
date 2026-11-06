import { randomUUID } from 'node:crypto';
import { openConnection } from '@workbench/persistence';
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

interface DocRow {
  uri: string;
  content: string;
  scope: string;
  superseded_by: string | null;
  revoked: number;
}

/**
 * SQLite 降级实现（26 SPEC §14.1：必须提供最小 SQLite 降级实现）。
 * 在 OpenViking 不可用时以本地 SQLite 持久化记忆。
 */
export class SqliteMemoryProvider implements MemoryProvider {
  private readonly db: ReturnType<typeof openConnection>;

  constructor(dbPath: string) {
    this.db = openConnection({ path: dbPath });
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_docs (
      uri TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      scope TEXT NOT NULL,
      superseded_by TEXT,
      revoked INTEGER NOT NULL DEFAULT 0
    );`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_candidates (
      uri TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      scope TEXT NOT NULL,
      source_uri TEXT
    );`);
  }

  async health(): Promise<MemoryHealth> {
    return { status: 'READY_READWRITE', ok: true };
  }

  async indexResource(input: ResourceInput): Promise<ResourceRef> {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO memory_docs (uri, content, scope, superseded_by, revoked) VALUES (?, ?, ?, NULL, 0)',
      )
      .run(input.uri, input.content, input.scope ?? 'project');
    return { uri: input.uri };
  }

  async search(query: MemoryQuery): Promise<MemoryHit[]> {
    const term = `%${query.query.toLowerCase()}%`;
    const rows = query.scope
      ? (this.db
          .prepare(
            'SELECT uri, content FROM memory_docs WHERE revoked = 0 AND superseded_by IS NULL AND scope = ? AND lower(content) LIKE ? ORDER BY uri',
          )
          .all(query.scope, term) as { uri: string; content: string }[])
      : (this.db
          .prepare(
            'SELECT uri, content FROM memory_docs WHERE revoked = 0 AND superseded_by IS NULL AND lower(content) LIKE ? ORDER BY uri',
          )
          .all(term) as { uri: string; content: string }[]);
    const hits: MemoryHit[] = rows.map((r) => ({
      uri: r.uri,
      score: 1,
      snippet: r.content.slice(0, 120),
    }));
    return hits.slice(0, query.limit ?? 10);
  }

  async read(uri: string): Promise<MemoryDocument> {
    const row = this.db
      .prepare('SELECT uri, content, scope FROM memory_docs WHERE uri = ?')
      .get(uri) as DocRow | undefined;
    if (!row) {
      throw new Error(`Memory 文档不存在: ${uri}`);
    }
    return { uri: row.uri, content: row.content, scope: row.scope as MemoryScope };
  }

  async createCandidate(input: CandidateInput): Promise<MemoryRef> {
    // uri 必须唯一：同一毫秒内多次提议不能相互覆盖（原先用 Date.now() 会碰撞）。
    const uri = `mem-cand-${randomUUID()}`;
    this.db
      .prepare(
        'INSERT INTO memory_candidates (uri, content, scope, source_uri) VALUES (?, ?, ?, ?)',
      )
      .run(uri, input.content, input.scope, input.sourceUri ?? null);
    return { uri };
  }

  async activate(ref: MemoryRef): Promise<void> {
    const cand = this.db
      .prepare('SELECT uri, content, scope FROM memory_candidates WHERE uri = ?')
      .get(ref.uri) as DocRow | undefined;
    if (!cand) {
      throw new Error(`候选不存在: ${ref.uri}`);
    }
    this.db
      .prepare(
        'INSERT OR REPLACE INTO memory_docs (uri, content, scope, superseded_by, revoked) VALUES (?, ?, ?, NULL, 0)',
      )
      .run(cand.uri, cand.content, cand.scope);
    this.db.prepare('DELETE FROM memory_candidates WHERE uri = ?').run(ref.uri);
  }

  async supersede(oldRef: MemoryRef, newRef: MemoryRef): Promise<void> {
    this.db
      .prepare('UPDATE memory_docs SET superseded_by = ? WHERE uri = ?')
      .run(newRef.uri, oldRef.uri);
  }

  async revoke(ref: MemoryRef): Promise<void> {
    this.db.prepare('UPDATE memory_docs SET revoked = 1 WHERE uri = ?').run(ref.uri);
  }

  async export(scope: MemoryScope): Promise<ExportBundle> {
    const rows = this.db
      .prepare('SELECT uri, content, scope FROM memory_docs WHERE revoked = 0 AND scope = ?')
      .all(scope) as DocRow[];
    return {
      scope,
      documents: rows.map((r) => ({
        uri: r.uri,
        content: r.content,
        scope: r.scope as MemoryScope,
      })),
    };
  }

  /** 关闭数据库连接（测试清理用）。 */
  close(): void {
    this.db.close();
  }
}
