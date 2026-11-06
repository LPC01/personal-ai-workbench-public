import type Database from 'better-sqlite3';
import type { RoomDecision } from '@workbench/contracts';

const DECISION_COLUMNS =
  'id, room_run_id, decision_type, result_json, evidence_refs_json, dissent_json, status, approval_id, created_at';

function mapDecision(row: Record<string, unknown>): RoomDecision {
  return {
    id: row.id as string,
    roomRunId: row.room_run_id as string,
    decisionType: row.decision_type as string,
    result: JSON.parse(row.result_json as string) as Record<string, unknown>,
    evidenceRefs: JSON.parse(row.evidence_refs_json as string) as string[],
    dissent: JSON.parse(row.dissent_json as string) as Record<string, unknown>,
    status: row.status as string,
    approvalId: (row.approval_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/** 决策存储（29 号 SPEC §8 room_decisions 表）。 */
export class DecisionStore {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    id: string;
    roomRunId: string;
    decisionType: string;
    result: Record<string, unknown>;
    evidenceRefs?: string[];
    dissent?: Record<string, unknown>;
    status?: string;
    approvalId?: string | null;
  }): RoomDecision {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO room_decisions (id, room_run_id, decision_type, result_json, evidence_refs_json, dissent_json, status, approval_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.roomRunId,
        input.decisionType,
        JSON.stringify(input.result),
        JSON.stringify(input.evidenceRefs ?? []),
        JSON.stringify(input.dissent ?? {}),
        input.status ?? 'PROPOSED',
        input.approvalId ?? null,
        now,
      );
    return this.get(input.id) as RoomDecision;
  }

  get(id: string): RoomDecision | undefined {
    const row = this.db
      .prepare(`SELECT ${DECISION_COLUMNS} FROM room_decisions WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapDecision(row) : undefined;
  }

  list(roomRunId: string): RoomDecision[] {
    return (
      this.db
        .prepare(
          `SELECT ${DECISION_COLUMNS} FROM room_decisions WHERE room_run_id = ? ORDER BY created_at ASC`,
        )
        .all(roomRunId) as Record<string, unknown>[]
    ).map(mapDecision);
  }

  updateStatus(id: string, status: string, approvalId?: string | null): RoomDecision {
    this.db
      .prepare('UPDATE room_decisions SET status = ?, approval_id = ? WHERE id = ?')
      .run(status, approvalId ?? null, id);
    return this.get(id) as RoomDecision;
  }
}
