import type Database from 'better-sqlite3';
import type {
  MemoryCandidateFilter,
  MemoryCandidateRecord,
  MemoryCenterPort,
  MemoryCenterStatus,
  MemoryResourceFilter,
  MemoryResourceRecord,
  MemoryScope,
  RecallAuditFilter,
  RecallAuditRecord,
} from '@workbench/contracts';

const CANDIDATE_COLUMNS =
  'uri, project_id, scope, content, status, source_uri, superseded_by, created_at, updated_at';
const RESOURCE_COLUMNS = 'uri, project_id, name, sensitivity, source_hash, created_at';
const AUDIT_COLUMNS =
  'id, project_id, query, scope, hit_uris_json, total_tokens, budget_tokens, injected_position, created_at';

function mapCandidate(row: Record<string, unknown>): MemoryCandidateRecord {
  return {
    uri: row.uri as string,
    projectId: (row.project_id as string | null) ?? null,
    scope: row.scope as MemoryScope,
    content: row.content as string,
    status: row.status as MemoryCenterStatus,
    sourceUri: (row.source_uri as string | null) ?? null,
    supersededBy: (row.superseded_by as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapResource(row: Record<string, unknown>): MemoryResourceRecord {
  return {
    uri: row.uri as string,
    projectId: row.project_id as string,
    name: row.name as string,
    sensitivity: row.sensitivity as MemoryResourceRecord['sensitivity'],
    sourceHash: (row.source_hash as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapAudit(row: Record<string, unknown>): RecallAuditRecord {
  return {
    id: row.id as string,
    projectId: (row.project_id as string | null) ?? null,
    query: row.query as string,
    scope: row.scope as MemoryScope,
    hitUris: JSON.parse(row.hit_uris_json as string) as string[],
    totalTokens: row.total_tokens as number,
    budgetTokens: row.budget_tokens as number,
    injectedPosition: row.injected_position as 'context',
    createdAt: row.created_at as string,
  };
}

/**
 * 记忆中心投影存储（migration 0019）。
 * 只存「工作台侧投影」：候选审核状态、已导入资源、召回审计；记忆内容事实源仍是 MemoryProvider。
 */
export class MemoryCenterStore implements MemoryCenterPort {
  constructor(private readonly db: Database.Database) {}

  saveCandidate(record: MemoryCandidateRecord): void {
    this.db
      .prepare(
        `INSERT INTO memory_center_candidates (${CANDIDATE_COLUMNS})
         VALUES (@uri, @project_id, @scope, @content, @status, @source_uri, @superseded_by, @created_at, @updated_at)
         ON CONFLICT(uri) DO UPDATE SET
           project_id = excluded.project_id,
           scope = excluded.scope,
           content = excluded.content,
           status = excluded.status,
           source_uri = excluded.source_uri,
           superseded_by = excluded.superseded_by,
           updated_at = excluded.updated_at`,
      )
      .run({
        uri: record.uri,
        project_id: record.projectId,
        scope: record.scope,
        content: record.content,
        status: record.status,
        source_uri: record.sourceUri,
        superseded_by: record.supersededBy,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  getCandidate(uri: string): MemoryCandidateRecord | undefined {
    const row = this.db
      .prepare(`SELECT ${CANDIDATE_COLUMNS} FROM memory_center_candidates WHERE uri = ?`)
      .get(uri) as Record<string, unknown> | undefined;
    return row ? mapCandidate(row) : undefined;
  }

  listCandidates(filter: MemoryCandidateFilter = {}): MemoryCandidateRecord[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId !== undefined) {
      where.push('project_id = ?');
      params.push(filter.projectId);
    }
    if (filter.statuses && filter.statuses.length > 0) {
      where.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`);
      params.push(...filter.statuses);
    }
    const sql = `SELECT ${CANDIDATE_COLUMNS} FROM memory_center_candidates${
      where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
    } ORDER BY updated_at DESC, uri`;
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(mapCandidate);
  }

  recordResource(record: MemoryResourceRecord): void {
    this.db
      .prepare(
        `INSERT INTO memory_center_resources (${RESOURCE_COLUMNS})
         VALUES (@uri, @project_id, @name, @sensitivity, @source_hash, @created_at)
         ON CONFLICT(uri) DO UPDATE SET
           project_id = excluded.project_id,
           name = excluded.name,
           sensitivity = excluded.sensitivity,
           source_hash = excluded.source_hash`,
      )
      .run({
        uri: record.uri,
        project_id: record.projectId,
        name: record.name,
        sensitivity: record.sensitivity,
        source_hash: record.sourceHash,
        created_at: record.createdAt,
      });
  }

  listResources(filter: MemoryResourceFilter = {}): MemoryResourceRecord[] {
    const params: unknown[] = [];
    let sql = `SELECT ${RESOURCE_COLUMNS} FROM memory_center_resources`;
    if (filter.projectId !== undefined) {
      sql += ' WHERE project_id = ?';
      params.push(filter.projectId);
    }
    sql += ' ORDER BY created_at DESC, uri';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(mapResource);
  }

  appendRecallAudit(record: RecallAuditRecord): void {
    this.db
      .prepare(
        `INSERT INTO memory_center_recall_audit (${AUDIT_COLUMNS})
         VALUES (@id, @project_id, @query, @scope, @hit_uris_json, @total_tokens, @budget_tokens, @injected_position, @created_at)`,
      )
      .run({
        id: record.id,
        project_id: record.projectId,
        query: record.query,
        scope: record.scope,
        hit_uris_json: JSON.stringify(record.hitUris),
        total_tokens: record.totalTokens,
        budget_tokens: record.budgetTokens,
        injected_position: record.injectedPosition,
        created_at: record.createdAt,
      });
  }

  listRecallAudits(filter: RecallAuditFilter = {}): RecallAuditRecord[] {
    const params: unknown[] = [];
    let sql = `SELECT ${AUDIT_COLUMNS} FROM memory_center_recall_audit`;
    if (filter.projectId !== undefined) {
      sql += ' WHERE project_id = ?';
      params.push(filter.projectId);
    }
    sql += ' ORDER BY created_at DESC, id';
    if (filter.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(mapAudit);
  }
}
