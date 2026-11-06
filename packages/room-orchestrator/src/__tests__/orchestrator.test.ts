import { describe, expect, it } from 'vitest';
import { AppError } from '@workbench/domain';
import type {
  AgentSession,
  AgentToolPolicy,
  ModelBinding,
  ProtocolLimits,
  RoomEvent,
  RoomEventType,
  RoomRun,
  RoomRunStatus,
  RoomWorkItem,
} from '@workbench/contracts';
import { RoomOrchestrator } from '../orchestrator.js';
import type { OrchestrationPorts } from '../ports.js';

const MODEL_BINDING: ModelBinding = { modelProfileId: 'p1', revision: 1 };
const TOOL_POLICY: AgentToolPolicy = { allowedTools: ['lint'] };
const LIMITS: ProtocolLimits = {
  maxTurns: 3,
  maxDurationSeconds: 3600,
  maxTotalTokens: 1000,
  maxCost: 1,
  noProgressTurns: 2,
};

/** 内存端口实现：镜像 persistence 的真实语义，供纯逻辑单测（不含 SQLite）。 */
class FakePorts implements OrchestrationPorts {
  runs = new Map<string, RoomRun>();
  events: RoomEvent[] = [];
  workItems = new Map<string, RoomWorkItem>();
  sessions = new Map<string, AgentSession>();
  private seq = 0;

  seedRun(id: string): RoomRun {
    const run: RoomRun = {
      id,
      roomId: 'room_1',
      topicId: null,
      protocolId: 'sdd-delivery',
      protocolVersion: '1.0',
      snapshot: {},
      budget: {},
      usage: {},
      status: 'CREATED',
      startedAt: null,
      finishedAt: null,
      errorCode: null,
      createdAt: new Date().toISOString(),
    };
    this.runs.set(id, run);
    return run;
  }

  getRun(id: string): RoomRun | undefined {
    return this.runs.get(id);
  }

  updateRunStatus(id: string, status: RoomRunStatus, opts: { errorCode?: string } = {}): RoomRun {
    const run = this.runs.get(id);
    if (!run) throw new Error('missing run');
    run.status = status;
    run.errorCode = opts.errorCode ?? null;
    if ((status === 'SUCCEEDED' || status === 'FAILED') && !run.finishedAt) {
      run.finishedAt = new Date().toISOString();
    }
    return run;
  }

  markRunStarted(id: string): RoomRun {
    const run = this.runs.get(id);
    if (!run) throw new Error('missing run');
    run.startedAt = new Date().toISOString();
    return run;
  }

  updateRunBudget(id: string, budget: Record<string, unknown>): RoomRun {
    const run = this.runs.get(id);
    if (!run) throw new Error('missing run');
    run.budget = { ...budget };
    return run;
  }

  updateRunUsage(id: string, usage: Record<string, unknown>): RoomRun {
    const run = this.runs.get(id);
    if (!run) throw new Error('missing run');
    run.usage = { ...usage };
    return run;
  }

  appendEvent(input: {
    roomRunId: string;
    eventType: RoomEventType;
    actorRef: string;
    payload?: Record<string, unknown>;
  }): RoomEvent {
    this.seq += 1;
    const event: RoomEvent = {
      id: this.seq,
      roomRunId: input.roomRunId,
      sequence: this.seq,
      eventType: input.eventType,
      actorRef: input.actorRef,
      visibility: {},
      payload: input.payload ?? {},
      payloadHash: 'h',
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  listEvents(roomRunId: string): RoomEvent[] {
    return this.events.filter((e) => e.roomRunId === roomRunId);
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
    const item: RoomWorkItem = {
      id: input.id,
      roomRunId: input.roomRunId,
      assigneeRef: input.assigneeRef ?? null,
      kind: input.kind,
      status: 'OPEN',
      inputRefs: input.inputRefs ?? [],
      acceptance: input.acceptance ?? {},
      outputRefs: [],
      createdAt: now,
      updatedAt: now,
    };
    this.workItems.set(item.id, item);
    return item;
  }

  getWorkItem(id: string): RoomWorkItem | undefined {
    return this.workItems.get(id);
  }

  updateWorkItem(
    id: string,
    patch: { status?: RoomWorkItem['status']; assigneeRef?: string | null; outputRefs?: string[] },
  ): RoomWorkItem {
    const item = this.workItems.get(id);
    if (!item) throw new Error('missing work item');
    if (patch.status !== undefined) item.status = patch.status;
    if (patch.assigneeRef !== undefined) item.assigneeRef = patch.assigneeRef;
    if (patch.outputRefs !== undefined) item.outputRefs = patch.outputRefs;
    item.updatedAt = new Date().toISOString();
    return item;
  }

  listWorkItems(roomRunId: string): RoomWorkItem[] {
    return [...this.workItems.values()].filter((w) => w.roomRunId === roomRunId);
  }

  createSession(input: {
    id: string;
    roomRunId: string;
    participantId: string;
    agentProfileSnapshot: Record<string, unknown>;
    modelBinding: ModelBinding;
    toolPolicy: AgentToolPolicy;
  }): AgentSession {
    const session: AgentSession = {
      id: input.id,
      roomRunId: input.roomRunId,
      participantId: input.participantId,
      agentProfileSnapshot: input.agentProfileSnapshot,
      modelBinding: input.modelBinding,
      toolPolicy: input.toolPolicy,
      contextCursor: 0,
      status: 'CREATED',
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  listSessions(roomRunId: string): AgentSession[] {
    return [...this.sessions.values()].filter((s) => s.roomRunId === roomRunId);
  }

  updateSessionStatus(id: string, status: string): AgentSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error('missing session');
    session.status = status;
    return session;
  }

  types(roomRunId: string): RoomEventType[] {
    return this.listEvents(roomRunId).map((e) => e.eventType);
  }
}

function setup() {
  const ports = new FakePorts();
  const run = ports.seedRun('run_1');
  const orch = new RoomOrchestrator(ports);
  const participants = [
    {
      participantId: 'designer',
      agentProfileSnapshot: { revision: 1 },
      modelBinding: MODEL_BINDING,
      toolPolicy: TOOL_POLICY,
    },
    {
      participantId: 'builder',
      agentProfileSnapshot: { revision: 2 },
      modelBinding: MODEL_BINDING,
      toolPolicy: TOOL_POLICY,
    },
  ];
  return { ports, run, orch, participants };
}

describe('RoomOrchestrator.start', () => {
  it('建立独立 AgentSession、固定预算、初始化任务板并进入 RUNNING', () => {
    const { ports, orch, participants } = setup();
    const result = orch.start('run_1', {
      participants,
      limits: LIMITS,
      workItems: [{ kind: 'implement', assigneeRef: 'builder', inputRefs: ['artifact://spec'] }],
    });

    expect(result.run.status).toBe('RUNNING');
    expect(result.run.startedAt).not.toBeNull();
    expect(result.run.budget).toMatchObject({ maxTurns: 3, maxTotalTokens: 1000 });
    // §7.1 每个参与者一个独立会话
    expect(result.sessions).toHaveLength(2);
    expect(new Set(result.sessions.map((s) => s.id)).size).toBe(2);
    expect(ports.listSessions('run_1')).toHaveLength(2);
    // 任务板 + 事实事件
    expect(result.workItems).toHaveLength(1);
    expect(result.workItems[0]?.kind).toBe('implement');
    const types = ports.types('run_1');
    expect(types).toContain('CONTEXT_SNAPSHOT_CREATED');
    expect(types).toContain('TASK_ASSIGNED');
  });

  it('非 CREATED 状态不可重复启动（409）', () => {
    const { orch, participants } = setup();
    orch.start('run_1', { participants, limits: LIMITS });
    try {
      orch.start('run_1', { participants, limits: LIMITS });
      throw new Error('应当拒绝');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('ROOM_RUN_STATE_CONFLICT');
      expect((err as AppError).httpStatus).toBe(409);
    }
  });

  it('无参与者拒绝启动', () => {
    const { orch } = setup();
    try {
      orch.start('run_1', { participants: [], limits: LIMITS });
      throw new Error('应当拒绝');
    } catch (err) {
      expect((err as AppError).code).toBe('PARTICIPANT_NOT_ALLOWED');
    }
  });

  it('不存在的 RoomRun 报 404', () => {
    const { orch, participants } = setup();
    try {
      orch.start('run_missing', { participants, limits: LIMITS });
      throw new Error('应当拒绝');
    } catch (err) {
      expect((err as AppError).code).toBe('ROOM_RUN_NOT_FOUND');
      expect((err as AppError).httpStatus).toBe(404);
    }
  });
});

describe('RoomOrchestrator.dispatchTurn', () => {
  function started() {
    const ctx = setup();
    ctx.orch.start('run_1', { participants: ctx.participants, limits: LIMITS });
    return ctx;
  }

  it('候选集合外的参与者被拒绝（403）', () => {
    const { orch } = started();
    try {
      orch.dispatchTurn('run_1', {
        participantId: 'outsider',
        allowedParticipants: ['designer'],
        content: 'hi',
        tokens: 10,
      });
      throw new Error('应当拒绝');
    } catch (err) {
      expect((err as AppError).code).toBe('PARTICIPANT_NOT_ALLOWED');
      expect((err as AppError).httpStatus).toBe(403);
    }
  });

  it('无 AgentSession 的参与者被拒绝（§7.1 会话隔离）', () => {
    // 直接置于 RUNNING 但不建立任何 AgentSession
    const ports = new FakePorts();
    const run = ports.seedRun('run_x');
    run.status = 'RUNNING';
    const isolated = new RoomOrchestrator(ports);
    try {
      isolated.dispatchTurn('run_x', {
        participantId: 'ghost',
        allowedParticipants: ['ghost'],
        content: 'hi',
        tokens: 10,
      });
      throw new Error('应当拒绝');
    } catch (err) {
      expect((err as AppError).code).toBe('PARTICIPANT_NOT_ALLOWED');
    }
  });

  it('正常发言累加预算并写 AGENT_TURN_STARTED / AGENT_MESSAGE', () => {
    const { ports, orch } = started();
    const { run, event } = orch.dispatchTurn('run_1', {
      participantId: 'designer',
      allowedParticipants: ['designer', 'builder'],
      content: 'Spec 草案如下',
      tokens: 120,
      cost: 0.1,
    });
    expect(run.usage).toMatchObject({ turns: 1, totalTokens: 120 });
    expect(event.eventType).toBe('AGENT_MESSAGE');
    expect(event.payload.content).toBe('Spec 草案如下');
    expect(ports.types('run_1')).toContain('AGENT_TURN_STARTED');
  });

  it('达到 maxTurns 时进入 BUDGET_EXCEEDED 并抛出 409', () => {
    const { ports, orch } = started();
    const turn = (n: number) =>
      orch.dispatchTurn('run_1', {
        participantId: 'designer',
        allowedParticipants: ['designer'],
        content: `t${n}`,
        tokens: 10,
      });
    turn(1);
    turn(2); // turns = 2 < 3
    try {
      turn(3); // turns 将达 3 === maxTurns → 拒绝
      throw new Error('应当拒绝');
    } catch (err) {
      expect((err as AppError).code).toBe('ROOM_BUDGET_EXCEEDED');
      expect((err as AppError).httpStatus).toBe(409);
    }
    expect(ports.getRun('run_1')?.status).toBe('BUDGET_EXCEEDED');
    expect(ports.types('run_1')).toContain('BUDGET_WARNING');
  });

  it('Token 超限同样触发预算终止', () => {
    const { ports, orch } = started();
    try {
      orch.dispatchTurn('run_1', {
        participantId: 'designer',
        allowedParticipants: ['designer'],
        content: 'huge',
        tokens: 5000,
      });
      throw new Error('应当拒绝');
    } catch (err) {
      expect((err as AppError).code).toBe('ROOM_BUDGET_EXCEEDED');
    }
    expect(ports.getRun('run_1')?.status).toBe('BUDGET_EXCEEDED');
  });
});

describe('RoomOrchestrator.handoff', () => {
  function started() {
    const ctx = setup();
    const res = ctx.orch.start('run_1', {
      participants: ctx.participants,
      limits: LIMITS,
      workItems: [{ kind: 'implement' }],
    });
    return { ...ctx, workItemId: res.workItems[0]?.id ?? '' };
  }

  it('合法 Handoff 指派任务板并写请求/完成事件', () => {
    const { ports, orch, workItemId } = started();
    const { workItem } = orch.handoff('run_1', {
      handoff: {
        toParticipantId: 'builder',
        workItemId,
        objective: '按已批准 Spec 实现',
        inputRefs: ['artifact://spec'],
        acceptance: ['tests pass'],
        reason: 'Spec 已批准',
      },
      allowedParticipants: ['designer', 'builder'],
    });
    expect(workItem.assigneeRef).toBe('builder');
    expect(workItem.status).toBe('ASSIGNED');
    const types = ports.types('run_1');
    expect(types).toContain('HANDOFF_REQUESTED');
    expect(types).toContain('HANDOFF_COMPLETED');
  });

  it('目标不在允许集合时拒绝（403）', () => {
    const { orch, workItemId } = started();
    try {
      orch.handoff('run_1', {
        handoff: {
          toParticipantId: 'stranger',
          workItemId,
          objective: 'x',
          inputRefs: [],
          acceptance: [],
          reason: 'r',
        },
        allowedParticipants: ['designer'],
      });
      throw new Error('应当拒绝');
    } catch (err) {
      expect((err as AppError).code).toBe('PARTICIPANT_NOT_ALLOWED');
      expect((err as AppError).httpStatus).toBe(403);
    }
  });

  it('WorkItem 不存在时拒绝', () => {
    const { orch } = started();
    try {
      orch.handoff('run_1', {
        handoff: {
          toParticipantId: 'builder',
          workItemId: 'wi_missing',
          objective: 'x',
          inputRefs: [],
          acceptance: [],
          reason: 'r',
        },
        allowedParticipants: ['builder'],
      });
      throw new Error('应当拒绝');
    } catch (err) {
      expect((err as AppError).code).toBe('ROOM_RUN_NOT_FOUND');
    }
  });
});

describe('RoomOrchestrator 工具回环与生命周期', () => {
  it('completeToolCall 关联平台 Run 并推进任务板', () => {
    const ctx = setup();
    const res = ctx.orch.start('run_1', {
      participants: ctx.participants,
      limits: LIMITS,
      workItems: [{ kind: 'implement' }],
    });
    const workItemId = res.workItems[0]?.id ?? '';
    ctx.orch.completeToolCall('run_1', {
      participantId: 'builder',
      platformRunId: 'run_platform_1',
      workItemId,
      ok: true,
    });
    const item = ctx.ports.getWorkItem(workItemId);
    expect(item?.status).toBe('SUBMITTED');
    expect(item?.outputRefs).toEqual(['run_platform_1']);
    expect(ctx.ports.types('run_1')).toContain('TOOL_CALL_COMPLETED');
  });

  it('finish SUCCEEDED 写 ROOM_RUN_COMPLETED；非终态目标被拒绝', () => {
    const ctx = setup();
    ctx.orch.start('run_1', { participants: ctx.participants, limits: LIMITS });
    try {
      ctx.orch.finish('run_1', 'RUNNING');
      throw new Error('应当拒绝');
    } catch (err) {
      expect((err as AppError).code).toBe('ROOM_RUN_STATE_CONFLICT');
    }
    const finished = ctx.orch.finish('run_1', 'SUCCEEDED');
    expect(finished.status).toBe('SUCCEEDED');
    expect(ctx.ports.types('run_1')).toContain('ROOM_RUN_COMPLETED');
  });

  it('detectStall 依据协议 noProgressTurns 判定无进展', () => {
    const ctx = setup();
    ctx.orch.start('run_1', { participants: ctx.participants, limits: LIMITS });
    expect(ctx.orch.detectStall('run_1', 1)).toBe(false);
    expect(ctx.orch.detectStall('run_1', 2)).toBe(true);
  });
});
