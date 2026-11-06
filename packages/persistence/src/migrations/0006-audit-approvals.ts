import type { Migration } from '../migration-runner.js';

/** Approvals 与 AuditEvents 表（26 SPEC §8.2 DDL 原样）。 */
export const auditApprovalsMigration: Migration = {
  version: 6,
  name: 'audit-approvals',
  up: (db) => {
    db.exec(`CREATE TABLE approvals (
      id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      request_json TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      decided_at TEXT,
      created_at TEXT NOT NULL
    );`);

    db.exec(`CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target_ref TEXT,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
  },
};
