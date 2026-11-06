import type { Migration } from '../migration-runner.js';

/** 模型使用量表（P8-02：26 SPEC §672 Metrics 模型延迟/错误/token；§8.2 未给 DDL，按契约字段设计）。 */
export const modelUsageMigration: Migration = {
  version: 16,
  name: 'model-usage',
  up: (db) => {
    db.exec(`CREATE TABLE model_usage (
      id TEXT PRIMARY KEY,
      model_profile_id TEXT,
      model_id TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      cost REAL NOT NULL,
      created_at TEXT NOT NULL
    );`);
    db.exec(`CREATE INDEX idx_model_usage_model ON model_usage (model_id);`);
    db.exec(`CREATE INDEX idx_model_usage_created ON model_usage (created_at);`);
  },
};
