import type { Migration } from '../migration-runner.js';

/** Studio 会话、消息与扩展草稿表（26 SPEC §10.3 + 设计 §6.6；§8.2 未给 DDL，按领域模型设计）。 */
export const studioMigration: Migration = {
  version: 11,
  name: 'studio',
  up: (db) => {
    db.exec(`CREATE TABLE studio_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);

    db.exec(`CREATE TABLE studio_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES studio_sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);

    db.exec(`CREATE TABLE extension_drafts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES studio_sessions(id),
      spec_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  },
};
