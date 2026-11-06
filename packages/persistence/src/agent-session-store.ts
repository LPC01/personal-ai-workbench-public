import type Database from 'better-sqlite3';
import type { AgentSession, AgentToolPolicy, ModelBinding } from '@workbench/contracts';

const SESSION_COLUMNS =
  'id, room_run_id, participant_id, agent_profile_snapshot_json, model_binding_json, tool_policy_json, context_cursor, status, created_at';

function mapSession(row: Record<string, unknown>): AgentSession {
  return {
    id: row.id as string,
    roomRunId: row.room_run_id as string,
    participantId: row.participant_id as string,
    agentProfileSnapshot: JSON.parse(row.agent_profile_snapshot_json as string) as Record<
      string,
      unknown
    >,
    modelBinding: JSON.parse(row.model_binding_json as string) as ModelBinding,
    toolPolicy: JSON.parse(row.tool_policy_json as string) as AgentToolPolicy,
    contextCursor: row.context_cursor as number,
    status: row.status as string,
    createdAt: row.created_at as string,
  };
}

/**
 * AgentSession 存储（29 号 SPEC §8）：每个 Participant 在每个 RoomRun 的独立会话，
 * 创建时固定 AgentProfile 快照 + 模型绑定快照 + 工具策略快照（§6/§7 隔离要求）。
 */
export class AgentSessionStore {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    id: string;
    roomRunId: string;
    participantId: string;
    agentProfileSnapshot: Record<string, unknown>;
    modelBinding: ModelBinding;
    toolPolicy: AgentToolPolicy;
  }): AgentSession {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_sessions (id, room_run_id, participant_id, agent_profile_snapshot_json, model_binding_json, tool_policy_json, context_cursor, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'CREATED', ?)`,
      )
      .run(
        input.id,
        input.roomRunId,
        input.participantId,
        JSON.stringify(input.agentProfileSnapshot),
        JSON.stringify(input.modelBinding),
        JSON.stringify(input.toolPolicy),
        now,
      );
    return this.get(input.id) as AgentSession;
  }

  get(id: string): AgentSession | undefined {
    const row = this.db
      .prepare(`SELECT ${SESSION_COLUMNS} FROM agent_sessions WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapSession(row) : undefined;
  }

  list(roomRunId: string): AgentSession[] {
    return (
      this.db
        .prepare(
          `SELECT ${SESSION_COLUMNS} FROM agent_sessions WHERE room_run_id = ? ORDER BY created_at ASC`,
        )
        .all(roomRunId) as Record<string, unknown>[]
    ).map(mapSession);
  }

  updateContextCursor(id: string, cursor: number): AgentSession {
    this.db.prepare('UPDATE agent_sessions SET context_cursor = ? WHERE id = ?').run(cursor, id);
    return this.get(id) as AgentSession;
  }

  updateStatus(id: string, status: string): AgentSession {
    this.db.prepare('UPDATE agent_sessions SET status = ? WHERE id = ?').run(status, id);
    return this.get(id) as AgentSession;
  }
}
