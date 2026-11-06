import type Database from 'better-sqlite3';
import type {
  Room,
  RoomEvent,
  RoomEventType,
  RoomProject,
  RoomRun,
  RoomRunStatus,
  RoomStatus,
  RoomTopic,
  RoomWorkItem,
} from '@workbench/contracts';

const ROOM_COLUMNS =
  'id, name, room_type, manifest_json, manifest_hash, status, created_at, updated_at';
const TOPIC_COLUMNS = 'id, room_id, title, status, created_at, closed_at';
const RUN_COLUMNS =
  'id, room_id, topic_id, protocol_id, protocol_version, snapshot_json, budget_json, usage_json, status, started_at, finished_at, error_code, created_at';
const EVENT_COLUMNS =
  'id, room_run_id, sequence, event_type, actor_ref, visibility_json, payload_json, payload_hash, created_at';
const WORKITEM_COLUMNS =
  'id, room_run_id, assignee_ref, kind, status, input_refs_json, acceptance_json, output_refs_json, created_at, updated_at';

function mapRoom(row: Record<string, unknown>): Room {
  return {
    id: row.id as string,
    name: row.name as string,
    roomType: row.room_type as Room['roomType'],
    manifest: JSON.parse(row.manifest_json as string) as Record<string, unknown>,
    manifestHash: row.manifest_hash as string,
    status: row.status as RoomStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapTopic(row: Record<string, unknown>): RoomTopic {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    title: row.title as string,
    status: row.status as string,
    createdAt: row.created_at as string,
    closedAt: (row.closed_at as string | null) ?? null,
  };
}

function mapRun(row: Record<string, unknown>): RoomRun {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    topicId: (row.topic_id as string | null) ?? null,
    protocolId: row.protocol_id as string,
    protocolVersion: row.protocol_version as string,
    snapshot: JSON.parse(row.snapshot_json as string) as Record<string, unknown>,
    budget: JSON.parse(row.budget_json as string) as Record<string, unknown>,
    usage: JSON.parse(row.usage_json as string) as Record<string, unknown>,
    status: row.status as RoomRunStatus,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    errorCode: (row.error_code as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapEvent(row: Record<string, unknown>): RoomEvent {
  return {
    id: row.id as number,
    roomRunId: row.room_run_id as string,
    sequence: row.sequence as number,
    eventType: row.event_type as RoomEventType,
    actorRef: row.actor_ref as string,
    visibility: JSON.parse(row.visibility_json as string) as Record<string, unknown>,
    payload: JSON.parse(row.payload_json as string) as Record<string, unknown>,
    payloadHash: row.payload_hash as string,
    createdAt: row.created_at as string,
  };
}

function mapWorkItem(row: Record<string, unknown>): RoomWorkItem {
  return {
    id: row.id as string,
    roomRunId: row.room_run_id as string,
    assigneeRef: (row.assignee_ref as string | null) ?? null,
    kind: row.kind as string,
    status: row.status as RoomWorkItem['status'],
    inputRefs: JSON.parse(row.input_refs_json as string) as string[],
    acceptance: JSON.parse(row.acceptance_json as string) as Record<string, unknown>,
    outputRefs: JSON.parse(row.output_refs_json as string) as string[],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * 聊天室存储（29 号 SPEC §8）：Room/Topic/Run/Event（不可变追加 + sequence 单调递增）/WorkItem。
 */
export class RoomStore {
  constructor(private readonly db: Database.Database) {}

  createRoom(input: {
    id: string;
    name: string;
    roomType: string;
    manifest: Record<string, unknown>;
    manifestHash: string;
    status?: RoomStatus;
  }): Room {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO rooms (id, name, room_type, manifest_json, manifest_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.roomType,
        JSON.stringify(input.manifest),
        input.manifestHash,
        input.status ?? 'DRAFT',
        now,
        now,
      );
    return this.getRoom(input.id) as Room;
  }

  listRooms(): Room[] {
    return (
      this.db.prepare(`SELECT ${ROOM_COLUMNS} FROM rooms ORDER BY created_at DESC`).all() as Record<
        string,
        unknown
      >[]
    ).map(mapRoom);
  }

  /** 列出某 Room 下的 Run（29 SPEC §11；known-limitations #8）。 */
  listRuns(roomId: string): RoomRun[] {
    return (
      this.db
        .prepare(`SELECT ${RUN_COLUMNS} FROM room_runs WHERE room_id = ? ORDER BY created_at DESC`)
        .all(roomId) as Record<string, unknown>[]
    ).map(mapRun);
  }

  getRoom(id: string): Room | undefined {
    const row = this.db.prepare(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return row ? mapRoom(row) : undefined;
  }

  updateRoomStatus(id: string, status: RoomStatus): Room {
    this.db
      .prepare('UPDATE rooms SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
    return this.getRoom(id) as Room;
  }

  createTopic(input: { id: string; roomId: string; title: string }): RoomTopic {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO room_topics (id, room_id, title, status, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(input.id, input.roomId, input.title, 'OPEN', now);
    const row = this.db
      .prepare(`SELECT ${TOPIC_COLUMNS} FROM room_topics WHERE id = ?`)
      .get(input.id) as Record<string, unknown>;
    return mapTopic(row);
  }

  createRun(input: {
    id: string;
    roomId: string;
    topicId?: string | null;
    protocolId: string;
    protocolVersion: string;
    snapshot?: Record<string, unknown>;
    budget?: Record<string, unknown>;
  }): RoomRun {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO room_runs (id, room_id, topic_id, protocol_id, protocol_version, snapshot_json, budget_json, usage_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', ?)`,
      )
      .run(
        input.id,
        input.roomId,
        input.topicId ?? null,
        input.protocolId,
        input.protocolVersion,
        JSON.stringify(input.snapshot ?? {}),
        JSON.stringify(input.budget ?? {}),
        JSON.stringify({}),
        now,
      );
    return this.getRun(input.id) as RoomRun;
  }

  getRun(id: string): RoomRun | undefined {
    const row = this.db.prepare(`SELECT ${RUN_COLUMNS} FROM room_runs WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return row ? mapRun(row) : undefined;
  }

  updateRunStatus(id: string, status: RoomRunStatus, opts: { errorCode?: string } = {}): RoomRun {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE room_runs SET status = ?, error_code = ?, finished_at = ? WHERE id = ?')
      .run(status, opts.errorCode ?? null, now, id);
    return this.getRun(id) as RoomRun;
  }

  /** 更新 Run 快照（如 SDD 阶段推进）。 */
  updateRunSnapshot(id: string, snapshot: Record<string, unknown>): RoomRun {
    this.db
      .prepare('UPDATE room_runs SET snapshot_json = ? WHERE id = ?')
      .run(JSON.stringify(snapshot), id);
    return this.getRun(id) as RoomRun;
  }

  /** 标记 Run 开始执行（started_at；§9.2）。 */
  markRunStarted(id: string): RoomRun {
    this.db
      .prepare('UPDATE room_runs SET started_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    return this.getRun(id) as RoomRun;
  }

  /** 更新 Run 协议预算上限（§12.3 协议 limits 快照）。 */
  updateRunBudget(id: string, budget: Record<string, unknown>): RoomRun {
    this.db
      .prepare('UPDATE room_runs SET budget_json = ? WHERE id = ?')
      .run(JSON.stringify(budget), id);
    return this.getRun(id) as RoomRun;
  }

  /** 更新 Run 预算用量（§21：轮次/Token/成本累计）。 */
  updateRunUsage(id: string, usage: Record<string, unknown>): RoomRun {
    this.db
      .prepare('UPDATE room_runs SET usage_json = ? WHERE id = ?')
      .run(JSON.stringify(usage), id);
    return this.getRun(id) as RoomRun;
  }

  /** 不可变追加事件，sequence 在单个 RoomRun 内单调递增（§10）。 */
  appendEvent(input: {
    roomRunId: string;
    eventType: RoomEventType;
    actorRef: string;
    visibility?: Record<string, unknown>;
    payload?: Record<string, unknown>;
    payloadHash?: string;
  }): RoomEvent {
    const seq = this.nextSequence(input.roomRunId);
    const now = new Date().toISOString();
    const payload = input.payload ?? {};
    this.db
      .prepare(
        `INSERT INTO room_events (room_run_id, sequence, event_type, actor_ref, visibility_json, payload_json, payload_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.roomRunId,
        seq,
        input.eventType,
        input.actorRef,
        JSON.stringify(input.visibility ?? {}),
        JSON.stringify(payload),
        input.payloadHash ?? 'sha256:empty',
        now,
      );
    const row = this.db
      .prepare(`SELECT ${EVENT_COLUMNS} FROM room_events WHERE room_run_id = ? AND sequence = ?`)
      .get(input.roomRunId, seq) as Record<string, unknown>;
    return mapEvent(row);
  }

  private nextSequence(roomRunId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sequence), 0) AS m FROM room_events WHERE room_run_id = ?')
      .get(roomRunId) as { m: number };
    return row.m + 1;
  }

  listEvents(roomRunId: string): RoomEvent[] {
    return (
      this.db
        .prepare(
          `SELECT ${EVENT_COLUMNS} FROM room_events WHERE room_run_id = ? ORDER BY sequence ASC`,
        )
        .all(roomRunId) as Record<string, unknown>[]
    ).map(mapEvent);
  }

  listEventsAfter(roomRunId: string, afterSequence: number): RoomEvent[] {
    return (
      this.db
        .prepare(
          `SELECT ${EVENT_COLUMNS} FROM room_events WHERE room_run_id = ? AND sequence > ? ORDER BY sequence ASC`,
        )
        .all(roomRunId, afterSequence) as Record<string, unknown>[]
    ).map(mapEvent);
  }

  createWorkItem(input: {
    id: string;
    roomRunId: string;
    assigneeRef?: string | null;
    kind: string;
    inputRefs?: string[];
    acceptance?: Record<string, unknown>;
  }): RoomWorkItem {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO room_work_items (id, room_run_id, assignee_ref, kind, status, input_refs_json, acceptance_json, output_refs_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'OPEN', ?, ?, '[]', ?, ?)`,
      )
      .run(
        input.id,
        input.roomRunId,
        input.assigneeRef ?? null,
        input.kind,
        JSON.stringify(input.inputRefs ?? []),
        JSON.stringify(input.acceptance ?? {}),
        now,
        now,
      );
    return this.getWorkItem(input.id) as RoomWorkItem;
  }

  getWorkItem(id: string): RoomWorkItem | undefined {
    const row = this.db
      .prepare(`SELECT ${WORKITEM_COLUMNS} FROM room_work_items WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapWorkItem(row) : undefined;
  }

  listWorkItems(roomRunId: string): RoomWorkItem[] {
    return (
      this.db
        .prepare(
          `SELECT ${WORKITEM_COLUMNS} FROM room_work_items WHERE room_run_id = ? ORDER BY created_at ASC`,
        )
        .all(roomRunId) as Record<string, unknown>[]
    ).map(mapWorkItem);
  }

  /** 更新 WorkItem（§9.3 任务板状态流转：状态 / 指派 / 产出引用）。 */
  updateWorkItem(
    id: string,
    patch: { status?: RoomWorkItem['status']; assigneeRef?: string | null; outputRefs?: string[] },
  ): RoomWorkItem {
    const current = this.getWorkItem(id);
    if (!current) {
      throw new Error(`WorkItem 不存在: ${id}`);
    }
    this.db
      .prepare(
        `UPDATE room_work_items SET status = ?, assignee_ref = ?, output_refs_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status ?? current.status,
        patch.assigneeRef === undefined ? current.assigneeRef : patch.assigneeRef,
        JSON.stringify(patch.outputRefs ?? current.outputRefs),
        new Date().toISOString(),
        id,
      );
    return this.getWorkItem(id) as RoomWorkItem;
  }

  /** 绑定项目到 Room（§13.1 room_projects：读/执行权限）。 */
  bindProject(input: {
    roomId: string;
    projectId: string;
    access: 'read' | 'execute';
  }): RoomProject {
    this.db
      .prepare(
        `INSERT INTO room_projects (room_id, project_id, access_json)
         VALUES (?, ?, ?)
         ON CONFLICT(room_id, project_id) DO UPDATE SET access_json = excluded.access_json`,
      )
      .run(input.roomId, input.projectId, JSON.stringify({ access: input.access }));
    return this.getProject(input.roomId, input.projectId) as RoomProject;
  }

  getProject(roomId: string, projectId: string): RoomProject | undefined {
    const row = this.db
      .prepare(
        'SELECT room_id, project_id, access_json FROM room_projects WHERE room_id = ? AND project_id = ?',
      )
      .get(roomId, projectId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      roomId: row.room_id as string,
      projectId: row.project_id as string,
      access: JSON.parse(row.access_json as string) as Record<string, unknown>,
    };
  }

  listProjects(roomId: string): RoomProject[] {
    return (
      this.db
        .prepare(
          'SELECT room_id, project_id, access_json FROM room_projects WHERE room_id = ? ORDER BY project_id',
        )
        .all(roomId) as Record<string, unknown>[]
    ).map((row) => ({
      roomId: row.room_id as string,
      projectId: row.project_id as string,
      access: JSON.parse(row.access_json as string) as Record<string, unknown>,
    }));
  }
}
