import type Database from 'better-sqlite3';

export interface AuditEventRecord {
  id: number;
  actor: string;
  action: string;
  targetRef: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target_ref: string | null;
  details_json: string;
  created_at: string;
}

function mapAuditRow(row: AuditRow): AuditEventRecord {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    targetRef: row.target_ref,
    details: JSON.parse(row.details_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

/** 审计事件存储（26 SPEC §8.2）：追加写、不可删（§8.1「禁止删除 AuditEvent」）。 */
export class AuditStore {
  constructor(private readonly db: Database.Database) {}

  record(
    actor: string,
    action: string,
    targetRef?: string,
    details: Record<string, unknown> = {},
  ): AuditEventRecord {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        'INSERT INTO audit_events (actor, action, target_ref, details_json, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(actor, action, targetRef ?? null, JSON.stringify(details), now);
    return {
      id: Number(result.lastInsertRowid),
      actor,
      action,
      targetRef: targetRef ?? null,
      details,
      createdAt: now,
    };
  }

  list(limit = 100): AuditEventRecord[] {
    const rows = this.db
      .prepare(
        'SELECT id, actor, action, target_ref, details_json, created_at FROM audit_events ORDER BY id DESC LIMIT ?',
      )
      .all(limit) as AuditRow[];
    return rows.map(mapAuditRow);
  }
}
