import type { AgentSessionStore, RoomStore } from '@workbench/persistence';
import type { OrchestrationPorts } from '@workbench/room-orchestrator';

/**
 * 编排端口适配器（29 SPEC §4 依赖边界）。
 *
 * `@workbench/room-orchestrator` 只依赖 domain/contracts；本文件位于 app 层（允许依赖 persistence），
 * 把既有事实源存储适配为编排端口，不新增数据模型。
 */
export function createOrchestrationPorts(
  roomStore: RoomStore,
  sessionStore: AgentSessionStore,
): OrchestrationPorts {
  return {
    getRun: (roomRunId) => roomStore.getRun(roomRunId),
    updateRunStatus: (roomRunId, status, opts) =>
      roomStore.updateRunStatus(roomRunId, status, opts),
    markRunStarted: (roomRunId) => roomStore.markRunStarted(roomRunId),
    updateRunBudget: (roomRunId, budget) => roomStore.updateRunBudget(roomRunId, budget),
    updateRunUsage: (roomRunId, usage) => roomStore.updateRunUsage(roomRunId, usage),
    appendEvent: (input) => roomStore.appendEvent(input),
    listEvents: (roomRunId) => roomStore.listEvents(roomRunId),
    createWorkItem: (input) => roomStore.createWorkItem(input),
    getWorkItem: (id) => roomStore.getWorkItem(id),
    updateWorkItem: (id, patch) => roomStore.updateWorkItem(id, patch),
    listWorkItems: (roomRunId) => roomStore.listWorkItems(roomRunId),
    createSession: (input) => sessionStore.create(input),
    listSessions: (roomRunId) => sessionStore.list(roomRunId),
    updateSessionStatus: (id, status) => sessionStore.updateStatus(id, status),
  };
}
