import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { HarnessSessionStatus, ToolPolicy } from '@workbench/contracts';

interface HarnessSessionRow {
  id: string;
  run_id: string | null;
  harness_profile_id: string;
  model_profile_id: string;
  agent_profile_id: string | null;
  tool_policy_json: string;
  status: string;
  context_cursor: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapSession(row: HarnessSessionRow): HarnessSessionRecord {
  return {
    id: row.id,
    runId: row.run_id,
    harnessProfileId: row.harness_profile_id,
    modelProfileId: row.model_profile_id,
    agentProfileId: row.agent_profile_id,
    toolPolicy: JSON.parse(row.tool_policy_json) as ToolPolicy,
    status: row.status as HarnessSessionStatus,
    contextCursor: row.context_cursor,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = `SELECT id, run_id, harness_profile_id, model_profile_id, agent_profile_id, tool_policy_json, status, context_cursor, revision, created_at, updated_at FROM harness_sessions`;

/** 持久化会话记录（含 run 关联，用于断线/重启恢复）。 */
export interface HarnessSessionRecord {
  id: string;
  runId: string | null;
  harnessProfileId: string;
  modelProfileId: string;
  agentProfileId: string | null;
  toolPolicy: ToolPolicy;
  status: HarnessSessionStatus;
  contextCursor: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHarnessSessionInput {
  id?: string;
  runId?: string;
  harnessProfileId: string;
  modelProfileId: string;
  agentProfileId?: string;
  toolPolicy: ToolPolicy;
}

/** Harness Session 存储（29 SPEC §3/§7）：隔离会话 + 上下文游标，用于断线/重启恢复。 */
export class HarnessSessionStore {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateHarnessSessionInput): HarnessSessionRecord {
    const id = input.id ?? `hses_${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO harness_sessions (id, run_id, harness_profile_id, model_profile_id, agent_profile_id, tool_policy_json, status, context_cursor, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'created', 0, 1, ?, ?)`,
      )
      .run(
        id,
        input.runId ?? null,
        input.harnessProfileId,
        input.modelProfileId,
        input.agentProfileId ?? null,
        JSON.stringify(input.toolPolicy),
        now,
        now,
      );
    return this.get(id) as HarnessSessionRecord;
  }

  get(id: string): HarnessSessionRecord | undefined {
    const row = this.db.prepare(`${SELECT} WHERE id = ?`).get(id) as HarnessSessionRow | undefined;
    return row ? mapSession(row) : undefined;
  }

  /** 更新上下文游标（消费事件后推进）。 */
  updateCursor(id: string, cursor: number): HarnessSessionRecord {
    this.db
      .prepare('UPDATE harness_sessions SET context_cursor = ?, updated_at = ? WHERE id = ?')
      .run(cursor, new Date().toISOString(), id);
    return this.get(id) as HarnessSessionRecord;
  }

  /** 更新会话状态。 */
  updateStatus(id: string, status: HarnessSessionStatus): HarnessSessionRecord {
    this.db
      .prepare('UPDATE harness_sessions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
    return this.get(id) as HarnessSessionRecord;
  }
}
