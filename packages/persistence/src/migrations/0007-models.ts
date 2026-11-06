import type { Migration } from '../migration-runner.js';

/** 模型 Provider 与 Profile 表（26 SPEC §12；§8.2 未给 DDL，按 §12 字段设计）。 */
export const modelsMigration: Migration = {
  version: 7,
  name: 'models',
  up: (db) => {
    db.exec(`CREATE TABLE model_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);

    db.exec(`CREATE TABLE model_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      context_limit INTEGER NOT NULL,
      default_params_json TEXT NOT NULL,
      data_boundary TEXT NOT NULL,
      fallback_profile_id TEXT,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  },
};
