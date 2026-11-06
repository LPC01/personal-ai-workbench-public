import type { Migration } from '../migration-runner.js';

/** Harness Session 表（26 SPEC §13 + 29 SPEC §3/§7；§8.2 未给 DDL，按 HarnessSession 字段设计）。 */
export const harnessSessionsMigration: Migration = {
  version: 9,
  name: 'harness-sessions',
  up: (db) => {
    db.exec(`CREATE TABLE harness_sessions (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      harness_profile_id TEXT NOT NULL,
      model_profile_id TEXT NOT NULL,
      agent_profile_id TEXT,
      tool_policy_json TEXT NOT NULL,
      status TEXT NOT NULL,
      context_cursor INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  },
};
