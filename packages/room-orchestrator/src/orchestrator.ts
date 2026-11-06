import {
  AppError,
  assertParticipantAllowed,
  canTransitionRoomRun,
  checkBudget,
  isNoProgress,
  validateHandoff,
} from '@workbench/domain';
import {
  ROOM_RUN_TERMINAL_STATUSES,
  type AgentSession,
  type AgentToolPolicy,
  type BudgetUsage,
  type Handoff,
  type ModelBinding,
  type ProtocolLimits,
  type RoomEvent,
  type RoomRun,
  type RoomRunStatus,
  type RoomWorkItem,
} from '@workbench/contracts';
import type { OrchestrationPorts } from './ports.js';

/** 参与者规格（§7.1：每个参与者固定 AgentProfile 快照 + 模型绑定 + 工具策略）。 */
export interface ParticipantSpec {
  participantId: string;
  agentProfileSnapshot: Record<string, unknown>;
  modelBinding: ModelBinding;
  toolPolicy: AgentToolPolicy;
}

export interface WorkItemSpec {
  kind: string;
  assigneeRef?: string | null;
  inputRefs?: string[];
  acceptance?: Record<string, unknown>;
}

export interface StartInput {
  participants: ParticipantSpec[];
  limits: ProtocolLimits;
  workItems?: WorkItemSpec[];
}

export interface TurnInput {
  participantId: string;
  allowedParticipants: string[];
  content: string;
  tokens: number;
  cost?: number;
}

export interface StartResult {
  run: RoomRun;
  sessions: AgentSession[];
  workItems: RoomWorkItem[];
}

/** 缺省协议上限（29 SPEC §12.3；调用方应在 start 时显式传入协议 limits）。 */
const DEFAULT_LIMITS: ProtocolLimits = {
  maxTurns: 20,
  maxDurationSeconds: 3600,
  maxTotalTokens: 200_000,
  maxCost: 10,
  noProgressTurns: 3,
};

const DEFAULT_USAGE: BudgetUsage = { turns: 0, totalTokens: 0, cost: 0 };

function uuid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 聊天室编排运行时（29 号 SPEC §4 架构 / §7 会话隔离 / §9 状态机 / §12 调度 / §21 预算）。
 *
 * 职责：把「协作状态」（RoomRun）驱动起来 —— 建立每参与者独立 AgentSession、
 * 按确定性顺序调度发言、执行预算门禁、写 Agent/Tool 事件、维护共享任务板与 Handoff。
 * 不负责实际模型/工具执行（由平台 Run + Execution Gateway 承担，§4）。
 */
export class RoomOrchestrator {
  constructor(private readonly ports: OrchestrationPorts) {}

  /**
   * 启动编排：CREATED → VALIDATING → READY → RUNNING。
   * 固定协议预算、建立 ContextSnapshot、为每个参与者创建独立 AgentSession、初始化共享任务板。
   */
  start(roomRunId: string, input: StartInput): StartResult {
    const run = this.requireRun(roomRunId);
    if (run.status !== 'CREATED') {
      throw new AppError('ROOM_RUN_STATE_CONFLICT', `RoomRun 状态 ${run.status} 不可启动`, {
        details: { roomRunId, status: run.status },
      });
    }
    if (input.participants.length === 0) {
      throw new AppError('PARTICIPANT_NOT_ALLOWED', '至少需要一个参与者才能启动编排', {
        details: { roomRunId },
      });
    }

    this.ports.updateRunStatus(roomRunId, 'VALIDATING');
    this.ports.updateRunBudget(roomRunId, { ...input.limits });
    this.ports.updateRunStatus(roomRunId, 'READY');
    this.ports.markRunStarted(roomRunId);

    // §7.5 并发阶段共用同一不可变 ContextSnapshot（发布者/来源/参与者/内容哈希）
    this.ports.appendEvent({
      roomRunId,
      eventType: 'CONTEXT_SNAPSHOT_CREATED',
      actorRef: 'system',
      payload: {
        participants: input.participants.map((p) => p.participantId),
        immutable: true,
      },
    });

    // §7.1 每个 Participant 在本 RoomRun 中拥有独立 AgentSession（快照固定，禁止热切换）
    const sessions = input.participants.map((p) =>
      this.ports.createSession({
        id: uuid('session'),
        roomRunId,
        participantId: p.participantId,
        agentProfileSnapshot: p.agentProfileSnapshot,
        modelBinding: p.modelBinding,
        toolPolicy: p.toolPolicy,
      }),
    );

    const started = this.ports.updateRunStatus(roomRunId, 'RUNNING');

    // §9.3 共享任务板初始化（每项写 TASK_ASSIGNED 事实事件）
    const workItems = (input.workItems ?? []).map((w) => {
      const item = this.ports.createWorkItem({
        id: uuid('wi'),
        roomRunId,
        assigneeRef: w.assigneeRef ?? null,
        kind: w.kind,
        inputRefs: w.inputRefs,
        acceptance: w.acceptance,
      });
      this.ports.appendEvent({
        roomRunId,
        eventType: 'TASK_ASSIGNED',
        actorRef: 'system',
        payload: { workItemId: item.id, assigneeRef: item.assigneeRef, kind: item.kind },
      });
      return item;
    });

    return { run: started, sessions, workItems };
  }

  /**
   * 一轮发言调度（§12.1）：candidate set → policy check → budget check → state transition check → dispatch。
   * 预算超限时进入 BUDGET_EXCEEDED 并抛出 ROOM_BUDGET_EXCEEDED（不产生新的模型调用）。
   */
  dispatchTurn(roomRunId: string, input: TurnInput): { run: RoomRun; event: RoomEvent } {
    const run = this.requireRun(roomRunId);
    if (run.status !== 'RUNNING' && run.status !== 'WAITING_AGENT') {
      throw new AppError('ROOM_RUN_STATE_CONFLICT', `RoomRun 状态 ${run.status} 不接受发言调度`, {
        details: { roomRunId, status: run.status },
      });
    }

    // 候选集合 + 策略检查（domain 纯逻辑抛裸 Error，此处统一归一化为平台错误码）
    try {
      assertParticipantAllowed(input.participantId, new Set(input.allowedParticipants));
    } catch (err) {
      throw new AppError('PARTICIPANT_NOT_ALLOWED', (err as Error).message, {
        details: { roomRunId, participantId: input.participantId },
      });
    }
    const session = this.ports
      .listSessions(roomRunId)
      .find((s) => s.participantId === input.participantId);
    if (!session) {
      throw new AppError(
        'PARTICIPANT_NOT_ALLOWED',
        `参与者 ${input.participantId} 没有 AgentSession（§7.1 会话隔离）`,
        { details: { roomRunId, participantId: input.participantId } },
      );
    }

    // 预算检查
    const limits = this.limitsOf(run);
    const current = this.usageOf(run);
    const next: BudgetUsage = {
      turns: current.turns + 1,
      totalTokens: current.totalTokens + input.tokens,
      cost: current.cost + (input.cost ?? 0),
    };
    const exceeded = checkBudget(limits, next, this.elapsedSeconds(run));
    if (exceeded) {
      this.ports.updateRunUsage(roomRunId, { ...next });
      this.ports.appendEvent({
        roomRunId,
        eventType: 'BUDGET_WARNING',
        actorRef: 'system',
        payload: { reason: exceeded, usage: next, limits },
      });
      this.ports.updateRunStatus(roomRunId, 'BUDGET_EXCEEDED', {
        errorCode: 'ROOM_BUDGET_EXCEEDED',
      });
      throw new AppError('ROOM_BUDGET_EXCEEDED', `预算超限（${exceeded}）`, {
        details: { roomRunId, reason: exceeded, usage: next, limits },
      });
    }

    this.ports.updateRunUsage(roomRunId, { ...next });
    this.ports.appendEvent({
      roomRunId,
      eventType: 'AGENT_TURN_STARTED',
      actorRef: input.participantId,
      payload: { sessionId: session.id, turn: next.turns },
    });
    const event = this.ports.appendEvent({
      roomRunId,
      eventType: 'AGENT_MESSAGE',
      actorRef: input.participantId,
      payload: { sessionId: session.id, content: input.content, tokens: input.tokens },
    });
    this.ports.updateSessionStatus(session.id, 'ACTIVE');
    return { run: this.requireRun(roomRunId), event };
  }

  /**
   * Handoff（§12.2）：目标必须在当前协议允许集合 → 写 HANDOFF_REQUESTED/COMPLETED →
   * 任务板指派并置为 ASSIGNED。
   */
  handoff(
    roomRunId: string,
    input: { handoff: Handoff; allowedParticipants: string[] },
  ): { workItem: RoomWorkItem; event: RoomEvent } {
    const run = this.requireRun(roomRunId);
    if (ROOM_RUN_TERMINAL_STATUSES.has(run.status)) {
      throw new AppError('ROOM_RUN_STATE_CONFLICT', `RoomRun 已处于终态 ${run.status}`, {
        details: { roomRunId, status: run.status },
      });
    }
    const err = validateHandoff(input.handoff, new Set(input.allowedParticipants));
    if (err) {
      throw new AppError('PARTICIPANT_NOT_ALLOWED', err, {
        details: { roomRunId, toParticipantId: input.handoff.toParticipantId },
      });
    }
    const item = this.ports.getWorkItem(input.handoff.workItemId);
    if (!item) {
      throw new AppError('ROOM_RUN_NOT_FOUND', 'Handoff 目标 WorkItem 不存在', {
        details: { workItemId: input.handoff.workItemId },
      });
    }

    this.ports.appendEvent({
      roomRunId,
      eventType: 'HANDOFF_REQUESTED',
      actorRef: 'system',
      payload: { ...input.handoff },
    });
    const updated = this.ports.updateWorkItem(item.id, {
      assigneeRef: input.handoff.toParticipantId,
      status: 'ASSIGNED',
    });
    const event = this.ports.appendEvent({
      roomRunId,
      eventType: 'HANDOFF_COMPLETED',
      actorRef: input.handoff.toParticipantId,
      payload: {
        workItemId: item.id,
        objective: input.handoff.objective,
        reason: input.handoff.reason,
      },
    });
    return { workItem: updated, event };
  }

  /**
   * 运行中新增任务条目（§9.3；UI-10 补齐：此前只有 start 时可批量建立）。
   * 同样写 TASK_ASSIGNED 事实事件，终态 Run 不再接受新增。
   */
  createWorkItem(roomRunId: string, input: WorkItemSpec): RoomWorkItem {
    const run = this.requireRun(roomRunId);
    if (ROOM_RUN_TERMINAL_STATUSES.has(run.status)) {
      throw new AppError('ROOM_RUN_STATE_CONFLICT', `RoomRun 已处于终态 ${run.status}`, {
        details: { roomRunId, status: run.status },
      });
    }
    const item = this.ports.createWorkItem({
      id: uuid('wi'),
      roomRunId,
      assigneeRef: input.assigneeRef ?? null,
      kind: input.kind,
      inputRefs: input.inputRefs,
      acceptance: input.acceptance,
    });
    this.ports.appendEvent({
      roomRunId,
      eventType: 'TASK_ASSIGNED',
      actorRef: 'system',
      payload: { workItemId: item.id, assigneeRef: item.assigneeRef, kind: item.kind },
    });
    return item;
  }

  /** 任务板状态流转（§9.3）。 */
  updateWorkItem(
    roomRunId: string,
    input: { workItemId: string; status: RoomWorkItem['status']; outputRefs?: string[] },
  ): RoomWorkItem {
    this.requireRun(roomRunId);
    return this.ports.updateWorkItem(input.workItemId, {
      status: input.status,
      outputRefs: input.outputRefs,
    });
  }

  /**
   * 工具调用完成（§10 TOOL_CALL_COMPLETED）：把平台 Run 作为 Tool Result 关联到任务板。
   */
  completeToolCall(
    roomRunId: string,
    input: { participantId: string; platformRunId: string; workItemId?: string; ok: boolean },
  ): RoomEvent {
    this.requireRun(roomRunId);
    const event = this.ports.appendEvent({
      roomRunId,
      eventType: 'TOOL_CALL_COMPLETED',
      actorRef: input.participantId,
      payload: { runId: input.platformRunId, ok: input.ok },
    });
    if (input.workItemId) {
      this.ports.updateWorkItem(input.workItemId, {
        status: input.ok ? 'SUBMITTED' : 'REWORK',
        outputRefs: [input.platformRunId],
      });
    }
    return event;
  }

  /** 结束编排（进入终态；SUCCEEDED 追加 ROOM_RUN_COMPLETED）。 */
  finish(roomRunId: string, status: RoomRunStatus, opts: { errorCode?: string } = {}): RoomRun {
    const run = this.requireRun(roomRunId);
    if (!ROOM_RUN_TERMINAL_STATUSES.has(status)) {
      throw new AppError('ROOM_RUN_STATE_CONFLICT', `finish 目标 ${status} 不是终态`, {
        details: { roomRunId, status },
      });
    }
    if (!canTransitionRoomRun(run.status, status)) {
      throw new AppError('ROOM_RUN_STATE_CONFLICT', `RoomRun 不允许从 ${run.status} 到 ${status}`, {
        details: { from: run.status, to: status },
      });
    }
    const updated = this.ports.updateRunStatus(roomRunId, status, {
      errorCode: opts.errorCode ?? (status === 'SUCCEEDED' ? undefined : status),
    });
    if (status === 'SUCCEEDED') {
      this.ports.appendEvent({
        roomRunId,
        eventType: 'ROOM_RUN_COMPLETED',
        actorRef: 'system',
        payload: { usage: this.usageOf(updated) },
      });
    }
    return updated;
  }

  /** 无进展检测（§12.3）：连续 noProgressTurns 轮无新增产出 → true。 */
  detectStall(roomRunId: string, noProgressTurns: number): boolean {
    return isNoProgress(noProgressTurns, this.limitsOf(this.requireRun(roomRunId)));
  }

  /** 只读：本 Run 的 AgentSession 列表（§7.1）。 */
  listSessions(roomRunId: string): AgentSession[] {
    this.requireRun(roomRunId);
    return this.ports.listSessions(roomRunId);
  }

  /** 只读：本 Run 的共享任务板（§9.3）。 */
  listWorkItems(roomRunId: string): RoomWorkItem[] {
    this.requireRun(roomRunId);
    return this.ports.listWorkItems(roomRunId);
  }

  private requireRun(roomRunId: string): RoomRun {
    const run = this.ports.getRun(roomRunId);
    if (!run) {
      throw new AppError('ROOM_RUN_NOT_FOUND', 'RoomRun 不存在', { details: { roomRunId } });
    }
    return run;
  }

  private limitsOf(run: RoomRun): ProtocolLimits {
    const b = run.budget;
    return {
      maxTurns: num(b.maxTurns, DEFAULT_LIMITS.maxTurns),
      maxDurationSeconds: num(b.maxDurationSeconds, DEFAULT_LIMITS.maxDurationSeconds),
      maxTotalTokens: num(b.maxTotalTokens, DEFAULT_LIMITS.maxTotalTokens),
      maxCost: num(b.maxCost, DEFAULT_LIMITS.maxCost),
      noProgressTurns: num(b.noProgressTurns, DEFAULT_LIMITS.noProgressTurns),
    };
  }

  private usageOf(run: RoomRun): BudgetUsage {
    const u = run.usage;
    return {
      turns: num(u.turns, DEFAULT_USAGE.turns),
      totalTokens: num(u.totalTokens, DEFAULT_USAGE.totalTokens),
      cost: num(u.cost, DEFAULT_USAGE.cost),
    };
  }

  private elapsedSeconds(run: RoomRun): number {
    const start = run.startedAt ?? run.createdAt;
    const started = Date.parse(start);
    if (Number.isNaN(started)) return 0;
    return Math.max(0, (Date.now() - started) / 1000);
  }
}
