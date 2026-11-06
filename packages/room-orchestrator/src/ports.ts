import type {
  AgentSession,
  AgentToolPolicy,
  ModelBinding,
  RoomEvent,
  RoomEventType,
  RoomRun,
  RoomRunStatus,
  RoomWorkItem,
} from '@workbench/contracts';

/**
 * 编排端口（29 号 SPEC §4 依赖边界：`room-orchestrator` 只能依赖 domain/contracts
 * 及平台公开 Gateway，不得直接依赖 persistence）。
 *
 * 由 app 层（允许依赖 persistence）提供实现，编排运行时只面向本接口编程。
 * 全部方法读写既有事实源（room_runs / room_events / room_work_items / agent_sessions），
 * 不新增数据模型。
 */
export interface OrchestrationPorts {
  getRun(roomRunId: string): RoomRun | undefined;
  updateRunStatus(roomRunId: string, status: RoomRunStatus, opts?: { errorCode?: string }): RoomRun;
  markRunStarted(roomRunId: string): RoomRun;
  updateRunBudget(roomRunId: string, budget: Record<string, unknown>): RoomRun;
  updateRunUsage(roomRunId: string, usage: Record<string, unknown>): RoomRun;

  appendEvent(input: {
    roomRunId: string;
    eventType: RoomEventType;
    actorRef: string;
    visibility?: Record<string, unknown>;
    payload?: Record<string, unknown>;
  }): RoomEvent;
  listEvents(roomRunId: string): RoomEvent[];

  createWorkItem(input: {
    id: string;
    roomRunId: string;
    assigneeRef?: string | null;
    kind: string;
    inputRefs?: string[];
    acceptance?: Record<string, unknown>;
  }): RoomWorkItem;
  getWorkItem(id: string): RoomWorkItem | undefined;
  updateWorkItem(
    id: string,
    patch: { status?: RoomWorkItem['status']; assigneeRef?: string | null; outputRefs?: string[] },
  ): RoomWorkItem;
  listWorkItems(roomRunId: string): RoomWorkItem[];

  createSession(input: {
    id: string;
    roomRunId: string;
    participantId: string;
    agentProfileSnapshot: Record<string, unknown>;
    modelBinding: ModelBinding;
    toolPolicy: AgentToolPolicy;
  }): AgentSession;
  listSessions(roomRunId: string): AgentSession[];
  updateSessionStatus(id: string, status: string): AgentSession;
}
