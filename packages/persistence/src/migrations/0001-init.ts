import type { Migration } from '../migration-runner.js';

/** 首个 migration：建立平台元数据表（验证 migration 机制的冒烟表，后续可承载平台版本等元数据）。 */
export const initMigration: Migration = {
  version: 1,
  name: 'init-app-meta',
  up: (db) => {
    db.exec(`CREATE TABLE app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  },
};
