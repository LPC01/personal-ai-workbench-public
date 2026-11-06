import type { Migration } from '../migration-runner.js';

/** Harness Profile 表（26 SPEC §13 + 设计 §6.9；§8.2 未给 DDL，按 HarnessProfile 字段设计）。 */
export const harnessProfilesMigration: Migration = {
  version: 8,
  name: 'harness-profiles',
  up: (db) => {
    db.exec(`CREATE TABLE harness_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      adapter_type TEXT NOT NULL,
      config_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  },
};
