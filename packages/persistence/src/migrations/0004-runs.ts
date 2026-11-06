import type { Migration } from '../migration-runner.js';

/** Run 与 RunEvent 表（26 SPEC §8.2 DDL 原样）。 */
export const runsMigration: Migration = {
  version: 4,
  name: 'runs',
  up: (db) => {
    db.exec(`CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      task_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      command_ref TEXT,
      extension_version_id TEXT,
      workflow_hash TEXT,
      model_binding_json TEXT,
      input_json TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      exit_code INTEGER,
      error_code TEXT,
      created_at TEXT NOT NULL
    );`);

    db.exec(`CREATE TABLE run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id),
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, sequence)
    );`);
  },
};
