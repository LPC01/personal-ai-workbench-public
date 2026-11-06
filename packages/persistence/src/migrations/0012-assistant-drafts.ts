import type { Migration } from '../migration-runner.js';

/** Assistant 草稿表（26 SPEC §10.1 L1 Assistant；§8.2 未给 DDL，按领域模型设计）。 */
export const assistantDraftsMigration: Migration = {
  version: 12,
  name: 'assistant-drafts',
  up: (db) => {
    db.exec(`CREATE TABLE assistant_drafts (
      id TEXT PRIMARY KEY,
      extension_draft_id TEXT NOT NULL UNIQUE REFERENCES extension_drafts(id),
      system_prompt TEXT NOT NULL,
      input_schema_json TEXT NOT NULL,
      output_schema_json TEXT NOT NULL,
      tool_whitelist_json TEXT NOT NULL,
      model_requirements_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  },
};
