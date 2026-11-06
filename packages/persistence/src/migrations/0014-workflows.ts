import type { Migration } from '../migration-runner.js';

/** Workflow 注册表表（26 SPEC §7 + §8.2 未给 workflow DDL，按领域模型设计）。 */
export const workflowsMigration: Migration = {
  version: 14,
  name: 'workflows',
  up: (db) => {
    db.exec(`CREATE TABLE workflows (
      id TEXT PRIMARY KEY,
      definition_id TEXT NOT NULL,
      version TEXT NOT NULL,
      content_hash TEXT NOT NULL UNIQUE,
      definition_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(definition_id, version)
    );`);
  },
};
