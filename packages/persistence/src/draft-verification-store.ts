import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { DraftCheckKind, DraftCheckResult, DraftCheckStatus } from '@workbench/contracts';

interface DraftCheckRow {
  id: string;
  extension_draft_id: string;
  kind: string;
  status: string;
  report_json: string;
  created_at: string;
}

function mapRow(row: DraftCheckRow): DraftCheckResult {
  return {
    id: row.id,
    extensionDraftId: row.extension_draft_id,
    kind: row.kind as DraftCheckKind,
    status: row.status as DraftCheckStatus,
    report: JSON.parse(row.report_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

const COLUMNS = 'id, extension_draft_id, kind, status, report_json, created_at';

/** 草稿验证结果存储（26 SPEC §10.3 + 设计 §10.3）。 */
export class DraftVerificationStore {
  constructor(private readonly db: Database.Database) {}

  record(
    extensionDraftId: string,
    kind: DraftCheckKind,
    status: DraftCheckStatus,
    report: Record<string, unknown>,
  ): DraftCheckResult {
    const id = `chk_${randomUUID()}`;
    this.db
      .prepare(
        'INSERT INTO draft_checks (id, extension_draft_id, kind, status, report_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, extensionDraftId, kind, status, JSON.stringify(report), new Date().toISOString());
    return this.get(id) as DraftCheckResult;
  }

  get(id: string): DraftCheckResult | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM draft_checks WHERE id = ?`).get(id) as
      DraftCheckRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  listByDraft(extensionDraftId: string): DraftCheckResult[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM draft_checks WHERE extension_draft_id = ? ORDER BY created_at`,
      )
      .all(extensionDraftId) as DraftCheckRow[];
    return rows.map(mapRow);
  }
}
