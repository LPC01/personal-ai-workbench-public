import type { Migration } from '../migration-runner.js';

/**
 * 记忆中心投影表（25 设计「记忆中心」子树）。
 *
 * 说明：记忆**内容**的事实源仍是 `MemoryProvider`（OpenViking 或本地降级实现）。
 * 本组表只是**工作台侧投影**，用于让「候选审核状态 / 已导入资源 / 召回审计」可持久化、
 * 可枚举 —— 否则 `MemoryReviewService.states` 这类进程内状态重启即失（known-limitations #6）。
 */
export const memoryCenterMigration: Migration = {
  version: 19,
  name: 'memory-center',
  up: (db) => {
    db.exec(`CREATE TABLE memory_center_candidates (
      uri TEXT PRIMARY KEY,
      project_id TEXT,
      scope TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      source_uri TEXT,
      superseded_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
    db.exec(
      'CREATE INDEX idx_memory_candidates_project_status ON memory_center_candidates (project_id, status);',
    );

    db.exec(`CREATE TABLE memory_center_resources (
      uri TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sensitivity TEXT NOT NULL,
      source_hash TEXT,
      created_at TEXT NOT NULL
    );`);
    db.exec('CREATE INDEX idx_memory_resources_project ON memory_center_resources (project_id);');

    db.exec(`CREATE TABLE memory_center_recall_audit (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      query TEXT NOT NULL,
      scope TEXT NOT NULL,
      hit_uris_json TEXT NOT NULL,
      total_tokens INTEGER NOT NULL,
      budget_tokens INTEGER NOT NULL,
      injected_position TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
    db.exec(
      'CREATE INDEX idx_memory_recall_project_created ON memory_center_recall_audit (project_id, created_at);',
    );
  },
};
