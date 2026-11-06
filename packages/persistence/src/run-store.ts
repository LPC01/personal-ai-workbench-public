import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  AppError,
  assertRunTransition,
  canTransitionRun,
  isTerminalRunStatus,
  resolveCancelStatus,
  RUN_INITIAL_STATUS,
  type RunStatus,
} from '@workbench/domain';

/** Run 类别（命令 type 为 service/job；Run kind 为 workflow/agent/builder/job）。 */
export type RunKind = 'job' | 'workflow' | 'agent' | 'builder';

export interface RunRecord {
  id: string;
  projectId: string | null;
  taskId: string | null;
  kind: RunKind;
  status: RunStatus;
  commandRef: string | null;
  extensionVersionId: string | null;
  workflowHash: string | null;
  modelBinding: Record<string, unknown> | null;
  input: Record<string, unknown>;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  errorCode: string | null;
  createdAt: string;
}

export interface RunEventRecord {
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CreateRunInput {
  id?: string;
  projectId?: string;
  taskId?: string;
  kind: RunKind;
  commandRef?: string;
  input?: Record<string, unknown>;
}

export interface TransitionRunOptions {
  exitCode?: number;
  errorCode?: string;
}

export interface ReconcileResult {
  runId: string;
  from: RunStatus;
  to: RunStatus;
}

interface RunRow {
  id: string;
  project_id: string | null;
  task_id: string | null;
  kind: string;
  status: string;
  command_ref: string | null;
  extension_version_id: string | null;
  workflow_hash: string | null;
  model_binding_json: string | null;
  input_json: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  error_code: string | null;
  created_at: string;
}

function mapRunRow(row: RunRow): RunRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    kind: row.kind as RunKind,
    status: row.status as RunStatus,
    commandRef: row.command_ref,
    extensionVersionId: row.extension_version_id,
    workflowHash: row.workflow_hash,
    modelBinding: row.model_binding_json
      ? (JSON.parse(row.model_binding_json) as Record<string, unknown>)
      : null,
    input: JSON.parse(row.input_json) as Record<string, unknown>,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    exitCode: row.exit_code,
    errorCode: row.error_code,
    createdAt: row.created_at,
  };
}

const RUN_COLUMNS =
  'id, project_id, task_id, kind, status, command_ref, extension_version_id, ' +
  'workflow_hash, model_binding_json, input_json, started_at, finished_at, exit_code, error_code, created_at';

/** Run 与 RunEvent 的存储（26 SPEC §8.2 + §9.1）。 */
export class RunStore {
  constructor(private readonly db: Database.Database) {}

  /** 创建 Run（初始状态 CREATED）。 */
  createRun(input: CreateRunInput): RunRecord {
    const id = input.id ?? `run_${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO runs (id, project_id, task_id, kind, status, command_ref, input_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId ?? null,
        input.taskId ?? null,
        input.kind,
        RUN_INITIAL_STATUS,
        input.commandRef ?? null,
        JSON.stringify(input.input ?? {}),
        now,
      );
    return this.getRun(id) as RunRecord;
  }

  /** 状态迁移：校验 §9.1 转换合法性，维护 started_at/finished_at 与可选 exit/error。 */
  transitionRun(id: string, to: RunStatus, opts: TransitionRunOptions = {}): RunRecord {
    const current = this.getRun(id);
    if (!current) {
      throw new Error(`Run 不存在: ${id}`);
    }
    assertRunTransition(current.status, to);

    const now = new Date().toISOString();
    const startedAt =
      current.startedAt ?? (to === 'STARTING' || to === 'RUNNING' ? now : current.startedAt);
    const finishedAt = current.finishedAt ?? (isTerminalRunStatus(to) ? now : current.finishedAt);

    this.db
      .prepare(
        'UPDATE runs SET status = ?, started_at = ?, finished_at = ?, exit_code = ?, error_code = ? WHERE id = ?',
      )
      .run(
        to,
        startedAt,
        finishedAt,
        opts.exitCode ?? current.exitCode,
        opts.errorCode ?? current.errorCode,
        id,
      );

    return this.getRun(id) as RunRecord;
  }

  /** 追加 RunEvent（sequence 自动递增，唯一约束 run_id+sequence）。 */
  appendRunEvent(
    runId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): RunEventRecord {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM run_events WHERE run_id = ?')
      .get(runId) as { max_seq: number };
    const sequence = row.max_seq + 1;
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO run_events (run_id, sequence, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(runId, sequence, eventType, JSON.stringify(payload), now);
    return { sequence, eventType, payload, createdAt: now };
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`).get(id) as
      RunRow | undefined;
    return row ? mapRunRow(row) : undefined;
  }

  listRuns(): RunRecord[] {
    const rows = this.db
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs ORDER BY created_at`)
      .all() as RunRow[];
    return rows.map(mapRunRow);
  }

  /** 列出某 RoomRun 创建的子 Run（§19 ROOM-SEC-007 取消传播）。 */
  listRunsByRoomRunId(roomRunId: string): RunRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM runs WHERE json_extract(input_json, '$.roomRunId') = ? ORDER BY created_at`,
      )
      .all(roomRunId) as RunRow[];
    return rows.map(mapRunRow);
  }

  /**
   * 列出某项目 + 某命令的**进行中** Run（26 SPEC §5 `concurrency: singleton` 判定）。
   * 终态由 domain 的 `isTerminalRunStatus` 裁定，避免在此硬编码状态集合。
   */
  listActiveRunsByCommand(projectId: string, commandRef: string): RunRecord[] {
    return this.listRuns().filter(
      (run) =>
        run.projectId === projectId &&
        run.commandRef === commandRef &&
        !isTerminalRunStatus(run.status),
    );
  }

  listRunEvents(runId: string): RunEventRecord[] {
    const rows = this.db
      .prepare(
        'SELECT sequence, event_type, payload_json, created_at FROM run_events WHERE run_id = ? ORDER BY sequence',
      )
      .all(runId) as {
      sequence: number;
      event_type: string;
      payload_json: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      sequence: r.sequence,
      eventType: r.event_type,
      payload: JSON.parse(r.payload_json) as Record<string, unknown>,
      createdAt: r.created_at,
    }));
  }

  /** 返回 sequence > afterSequence 的事件（用于 SSE 断线重连回放）。 */
  listRunEventsAfter(runId: string, afterSequence: number): RunEventRecord[] {
    const rows = this.db
      .prepare(
        'SELECT sequence, event_type, payload_json, created_at FROM run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence',
      )
      .all(runId, afterSequence) as {
      sequence: number;
      event_type: string;
      payload_json: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      sequence: r.sequence,
      eventType: r.event_type,
      payload: JSON.parse(r.payload_json) as Record<string, unknown>,
      createdAt: r.created_at,
    }));
  }

  /** 取消 Run（§10.2）：QUEUED→CANCELLED；RUNNING/WAITING_USER→CANCELLING；幂等。 */
  cancelRun(runId: string): RunRecord {
    const run = this.requireRun(runId);
    const target = resolveCancelStatus(run.status);
    if (target === null) {
      throw new AppError('RUN_NOT_CANCELABLE', 'Run 已结束或不可取消', {
        details: { runId, status: run.status },
      });
    }
    if (target === run.status) {
      return run;
    }
    return this.transitionRun(runId, target);
  }

  /** 超时：从允许 →FAILED 的状态标记为失败（error_code=TIMEOUT）。 */
  timeoutRun(runId: string): RunRecord {
    const run = this.requireRun(runId);
    if (!canTransitionRun(run.status, 'FAILED')) {
      throw new AppError('RUN_STATE_CONFLICT', `状态 ${run.status} 不可超时失败`, {
        details: { runId, status: run.status },
      });
    }
    return this.transitionRun(runId, 'FAILED', { errorCode: 'TIMEOUT' });
  }

  /** 标记 UNKNOWN（进程状态不可判定，§9.1）。 */
  markUnknown(runId: string): RunRecord {
    const run = this.requireRun(runId);
    if (!canTransitionRun(run.status, 'UNKNOWN')) {
      throw new AppError('RUN_STATE_CONFLICT', `状态 ${run.status} 不可标记 UNKNOWN`, {
        details: { runId, status: run.status },
      });
    }
    return this.transitionRun(runId, 'UNKNOWN');
  }

  /** 对账：UNKNOWN→RECONCILING→actual（RUNNING/SUCCEEDED/FAILED/CANCELLED），§11 Host 重启对账。 */
  reconcileRun(runId: string, actual: RunStatus, opts: TransitionRunOptions = {}): RunRecord {
    const run = this.requireRun(runId);
    let current = run.status;
    if (current === 'UNKNOWN') {
      current = this.transitionRun(runId, 'RECONCILING').status;
    }
    if (current !== 'RECONCILING') {
      throw new AppError('RUN_STATE_CONFLICT', `状态 ${current} 不可对账`, {
        details: { runId, status: current },
      });
    }
    if (!canTransitionRun('RECONCILING', actual)) {
      throw new AppError('RUN_STATE_CONFLICT', `对账落点 ${actual} 非法`, {
        details: { runId, actual },
      });
    }
    return this.transitionRun(runId, actual, opts);
  }

  /**
   * Host 启动对账（§11「Host 启动时必须对非终态 Run 对账」）：
   * 扫描所有非终态 Run，进程已随主机重启丢失，一律收敛到终态
   * （RUNNING/STARTING/CANCELLING→UNKNOWN→RECONCILING→FAILED；QUEUED→CANCELLED；其余→FAILED）。
   */
  reconcileOnStartup(): ReconcileResult[] {
    const results: ReconcileResult[] = [];
    for (const run of this.listRuns()) {
      if (isTerminalRunStatus(run.status)) {
        continue;
      }
      const from = run.status;
      switch (run.status) {
        case 'STARTING':
        case 'RUNNING':
        case 'CANCELLING':
          this.markUnknown(run.id);
          this.reconcileRun(run.id, 'FAILED', { errorCode: 'HOST_RESTARTED' });
          break;
        case 'UNKNOWN':
        case 'RECONCILING':
          this.reconcileRun(run.id, 'FAILED', { errorCode: 'HOST_RESTARTED' });
          break;
        case 'QUEUED':
          this.cancelRun(run.id);
          break;
        case 'WAITING_USER':
          this.transitionRun(run.id, 'FAILED', { errorCode: 'HOST_RESTARTED' });
          break;
        case 'CREATED':
          this.transitionRun(run.id, 'VALIDATING');
          this.transitionRun(run.id, 'FAILED', { errorCode: 'HOST_RESTARTED' });
          break;
        case 'VALIDATING':
          this.transitionRun(run.id, 'FAILED', { errorCode: 'HOST_RESTARTED' });
          break;
        default:
          continue;
      }
      results.push({ runId: run.id, from, to: (this.getRun(run.id) as RunRecord).status });
    }
    return results;
  }

  private requireRun(runId: string): RunRecord {
    const run = this.getRun(runId);
    if (!run) {
      throw new AppError('RUN_NOT_FOUND', 'Run 不存在', { details: { runId } });
    }
    return run;
  }
}
