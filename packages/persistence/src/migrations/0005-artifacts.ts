import type { Migration } from '../migration-runner.js';

/** Artifact 表（26 SPEC §8.2 DDL 原样）。 */
export const artifactsMigration: Migration = {
  version: 5,
  name: 'artifacts',
  up: (db) => {
    db.exec(`CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      project_id TEXT REFERENCES projects(id),
      kind TEXT NOT NULL,
      logical_name TEXT NOT NULL,
      storage_ref TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      media_type TEXT,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );`);
  },
};
