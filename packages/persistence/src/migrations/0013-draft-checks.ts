import type { Migration } from '../migration-runner.js';

/** 草稿验证结果表（26 SPEC §10.3 + 设计 §10.3；§8.2 未给 DDL，按领域模型设计）。 */
export const draftChecksMigration: Migration = {
  version: 13,
  name: 'draft-checks',
  up: (db) => {
    db.exec(`CREATE TABLE draft_checks (
      id TEXT PRIMARY KEY,
      extension_draft_id TEXT NOT NULL REFERENCES extension_drafts(id),
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
  },
};
