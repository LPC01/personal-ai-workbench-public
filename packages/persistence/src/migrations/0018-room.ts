import type { Migration } from '../migration-runner.js';

/** 多智能体协作聊天室表（29 号 SPEC §8 数据模型）。 */
export const roomMigration: Migration = {
  version: 18,
  name: 'room',
  up: (db) => {
    db.exec(`CREATE TABLE agent_profiles (
      id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      definition_json TEXT NOT NULL,
      definition_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (id, revision)
    );`);

    db.exec(`CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      room_type TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);

    db.exec(`CREATE TABLE room_projects (
      room_id TEXT NOT NULL REFERENCES rooms(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      access_json TEXT NOT NULL,
      PRIMARY KEY (room_id, project_id)
    );`);

    db.exec(`CREATE TABLE room_topics (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id),
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      closed_at TEXT
    );`);

    db.exec(`CREATE TABLE room_runs (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id),
      topic_id TEXT REFERENCES room_topics(id),
      protocol_id TEXT NOT NULL,
      protocol_version TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      budget_json TEXT NOT NULL,
      usage_json TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL
    );`);

    db.exec(`CREATE TABLE room_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_run_id TEXT NOT NULL REFERENCES room_runs(id),
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor_ref TEXT NOT NULL,
      visibility_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(room_run_id, sequence)
    );`);

    db.exec(`CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY,
      room_run_id TEXT NOT NULL REFERENCES room_runs(id),
      participant_id TEXT NOT NULL,
      agent_profile_snapshot_json TEXT NOT NULL,
      model_binding_json TEXT NOT NULL,
      tool_policy_json TEXT NOT NULL,
      context_cursor INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(room_run_id, participant_id)
    );`);

    db.exec(`CREATE TABLE room_work_items (
      id TEXT PRIMARY KEY,
      room_run_id TEXT NOT NULL REFERENCES room_runs(id),
      assignee_ref TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      input_refs_json TEXT NOT NULL,
      acceptance_json TEXT NOT NULL,
      output_refs_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);

    db.exec(`CREATE TABLE room_decisions (
      id TEXT PRIMARY KEY,
      room_run_id TEXT NOT NULL REFERENCES room_runs(id),
      decision_type TEXT NOT NULL,
      result_json TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      dissent_json TEXT NOT NULL,
      status TEXT NOT NULL,
      approval_id TEXT REFERENCES approvals(id),
      created_at TEXT NOT NULL
    );`);
  },
};
