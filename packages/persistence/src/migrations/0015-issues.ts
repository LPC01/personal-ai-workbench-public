import type { Migration } from '../migration-runner.js';

/** Issue 与 Evidence 表（25 设计 §6.11；§8.2 未给 DDL，按领域模型设计）。 */
export const issuesMigration: Migration = {
  version: 15,
  name: 'issues',
  up: (db) => {
    db.exec(`CREATE TABLE issues (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      project_id TEXT,
      extension_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);

    db.exec(`CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id),
      kind TEXT NOT NULL,
      uri TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
  },
};
