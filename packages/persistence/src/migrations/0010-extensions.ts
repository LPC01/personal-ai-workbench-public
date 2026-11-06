import type { Migration } from '../migration-runner.js';

/** Extension 与 Version 表（26 SPEC §8.2 权威 DDL）。 */
export const extensionsMigration: Migration = {
  version: 10,
  name: 'extensions',
  up: (db) => {
    db.exec(`CREATE TABLE extensions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled_version_id TEXT,
      created_at TEXT NOT NULL
    );`);

    db.exec(`CREATE TABLE extension_versions (
      id TEXT PRIMARY KEY,
      extension_id TEXT NOT NULL REFERENCES extensions(id),
      version TEXT NOT NULL,
      package_hash TEXT NOT NULL UNIQUE,
      spec_json TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(extension_id, version)
    );`);
  },
};
