import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ApprovalRecord {
  id: string;
  actionType: string;
  targetRef: string;
  request: Record<string, unknown>;
  status: ApprovalStatus;
  expiresAt: string;
  decidedAt: string | null;
  createdAt: string;
}

export interface CreateApprovalInput {
  id?: string;
  actionType: string;
  targetRef: string;
  request?: Record<string, unknown>;
  expiresAt: string;
}

interface ApprovalRow {
  id: string;
  action_type: string;
  target_ref: string;
  request_json: string;
  status: string;
  expires_at: string;
  decided_at: string | null;
  created_at: string;
}

function mapApprovalRow(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    actionType: row.action_type,
    targetRef: row.target_ref,
    request: JSON.parse(row.request_json) as Record<string, unknown>,
    status: row.status as ApprovalStatus,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

const APPROVAL_COLUMNS =
  'id, action_type, target_ref, request_json, status, expires_at, decided_at, created_at';

/** 人工审批存储（26 SPEC §8.2 + SEC-008）：PENDING → APPROVED/REJECTED。 */
export class ApprovalStore {
  constructor(private readonly db: Database.Database) {}

  /** 创建审批（状态 PENDING）。 */
  create(input: CreateApprovalInput): ApprovalRecord {
    const id = input.id ?? `apr_${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO approvals (id, action_type, target_ref, request_json, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.actionType,
        input.targetRef,
        JSON.stringify(input.request ?? {}),
        'PENDING',
        input.expiresAt,
        now,
      );
    return this.get(id) as ApprovalRecord;
  }

  /** 裁决：仅 PENDING 可裁决为 APPROVED/REJECTED，记录 decided_at。 */
  decide(id: string, approved: boolean): ApprovalRecord {
    const approval = this.get(id);
    if (!approval) {
      throw new Error(`Approval 不存在: ${id}`);
    }
    if (approval.status !== 'PENDING') {
      throw new Error(`Approval 已裁决: ${approval.status}`);
    }
    if (new Date(approval.expiresAt).getTime() <= Date.now()) {
      throw new Error(`Approval 已过期: ${id}`);
    }
    const status: ApprovalStatus = approved ? 'APPROVED' : 'REJECTED';
    const decidedAt = new Date().toISOString();
    this.db
      .prepare('UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?')
      .run(status, decidedAt, id);
    return this.get(id) as ApprovalRecord;
  }

  get(id: string): ApprovalRecord | undefined {
    const row = this.db
      .prepare(`SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE id = ?`)
      .get(id) as ApprovalRow | undefined;
    return row ? mapApprovalRow(row) : undefined;
  }

  list(): ApprovalRecord[] {
    const rows = this.db
      .prepare(`SELECT ${APPROVAL_COLUMNS} FROM approvals ORDER BY created_at`)
      .all() as ApprovalRow[];
    return rows.map(mapApprovalRow);
  }
}
