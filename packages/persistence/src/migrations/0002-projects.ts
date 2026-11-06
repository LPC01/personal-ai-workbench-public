import type { Migration } from '../migration-runner.js';

/** 项目目录表（26 SPEC §8.2 DDL 原样）。 */
export const projectsMigration: Migration = {
  version: 2,
  name: 'projects',
  up: (db) => {
    db.exec(`CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      manifest_hash TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  },
};
