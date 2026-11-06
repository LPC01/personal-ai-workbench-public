import type { FastifyInstance } from 'fastify';
import { AppError } from '@workbench/domain';
import type { Handoff, ProtocolLimits, RoomRunStatus, RoomWorkItem } from '@workbench/contracts';
import type { ParticipantSpec, RoomOrchestrator } from '@workbench/room-orchestrator';
import type { RoomStore } from '@workbench/persistence';
import { RunStreamHub } from '@workbench/project-runtime';
import {
  bindHarnessSession,
  buildParticipantSnapshot,
  type RoomAutoTurnService,
  type RoomParticipantInput,
} from '../room-auto-turn-service.js';

/**
 * 编排运行时 API（29 SPEC §12 调度 / §9.2 生命周期 / §21 预算）。
 *
 * 说明：29 SPEC §11 的 API 清单未定义编排触发端点与「按房间列 Run」，二者属 SPEC 缺口补齐
 * （known-limitations #7/#8）。端点遵循既有 `/room-runs/{runId}/...` 约定。
 */
export function registerOrchestrationRoutes(
  app: FastifyInstance,
  orchestrator: RoomOrchestrator,
  roomStore: RoomStore,
  hub?: RunStreamHub,
  /** 自动轮次服务（由 app 层装配，未装配时 auto-turn 端点返回明确错误）。 */
  autoTurnService?: RoomAutoTurnService,
): void {
  /** SSE 推送水位：只推本次新增事件，避免每次操作把全部历史重推一遍（前端重复）。 */
  const watermarks = new Map<string, number>();

  const publish = (runId: string): void => {
    if (!hub) return;
    const seen = watermarks.get(runId) ?? 0;
    const events = roomStore.listEventsAfter(runId, seen);
    for (const e of events) {
      hub.publish(runId, {
        sequence: e.sequence,
        eventType: e.eventType,
        payload: e.payload,
        createdAt: e.createdAt,
      });
    }
    const last = events[events.length - 1];
    if (last) watermarks.set(runId, last.sequence);
  };
  /** #8：列出某 Room 下的 Run（含 SDD Run 与协作 Run）。 */
  app.get('/api/v1/rooms/:roomId/runs', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const items = roomStore.listRuns(roomId);
    return { items, total: items.length };
  });

  /** 自动轮次（UI-10）：一次调用推进 N 个参与者真实发言（模型调用 → 编排门禁）。 */
  app.post('/api/v1/room-runs/:runId/orchestrate/auto-turn', async (request) => {
    const { runId } = request.params as { runId: string };
    if (!autoTurnService) {
      throw new AppError(
        'ROOM_RUN_STATE_CONFLICT',
        '未装配自动轮次服务（服务端缺少 Harness/Run 依赖），请使用 /orchestrate/turn 手动派发',
        { details: { runId } },
      );
    }
    const body = (request.body ?? {}) as {
      content?: string;
      participantId?: string;
      rounds?: number;
      timeoutSeconds?: number;
    };
    const result = await autoTurnService.run({ roomRunId: runId, ...body });
    publish(runId);
    return result;
  });

  /**
   * 启动编排：建立 AgentSession、固定预算、初始化共享任务板。
   *
   * UI-10 扩展：`participants[].harnessProfileId` 存在时，为每个参与者额外建立
   * Harness Session（真实模型调用载体），其 id 折叠进不可变快照持久化；
   * 不传该字段则保持原行为（纯人工派发），既有调用方与测试不受影响。
   */
  app.post('/api/v1/room-runs/:runId/orchestrate/start', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      participants: (ParticipantSpec & Partial<RoomParticipantInput>)[];
      limits: ProtocolLimits;
      workItems?: { kind: string; assigneeRef?: string | null }[];
      projectId?: string;
    };
    const participants: ParticipantSpec[] = [];
    const list = body.participants ?? [];
    for (const [index, p] of list.entries()) {
      const binding = p.harnessProfileId
        ? await bindHarnessSession(
            autoTurnService?.agentRunService,
            {
              participantId: p.participantId,
              agentProfileId: p.agentProfileId ?? undefined,
              harnessProfileId: p.harnessProfileId,
              modelBinding: p.modelBinding ?? { modelProfileId: '' },
              toolPolicy: p.toolPolicy ?? { allowedTools: [] },
              systemInstruction: p.systemInstruction ?? undefined,
              agentProfileSnapshot: p.agentProfileSnapshot,
            },
            { projectId: body.projectId },
          )
        : {};
      participants.push({
        participantId: p.participantId,
        agentProfileSnapshot: buildParticipantSnapshot(
          {
            participantId: p.participantId,
            agentProfileId: p.agentProfileId ?? undefined,
            harnessProfileId: p.harnessProfileId,
            modelBinding: p.modelBinding ?? { modelProfileId: '' },
            toolPolicy: p.toolPolicy ?? { allowedTools: [] },
            systemInstruction: p.systemInstruction ?? undefined,
            agentProfileSnapshot: p.agentProfileSnapshot,
          },
          binding,
          index,
        ),
        modelBinding: p.modelBinding ?? { modelProfileId: '', revision: 1 },
        toolPolicy: p.toolPolicy ?? { allowedTools: [] },
      });
    }
    const result = orchestrator.start(runId, { ...body, participants });
    publish(runId);
    return result;
  });

  /** 一轮发言调度（候选集合 → 策略 → 预算 → 状态 → 派发）。 */
  app.post('/api/v1/room-runs/:runId/orchestrate/turn', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      participantId: string;
      allowedParticipants: string[];
      content: string;
      tokens?: number;
      cost?: number;
    };
    const result = orchestrator.dispatchTurn(runId, {
      participantId: body.participantId,
      allowedParticipants: body.allowedParticipants,
      content: body.content,
      tokens: body.tokens ?? 0,
      cost: body.cost,
    });
    publish(runId);
    return result;
  });

  /** Handoff 交接（§12.2）。 */
  app.post('/api/v1/room-runs/:runId/orchestrate/handoff', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as { handoff: Handoff; allowedParticipants: string[] };
    const result = orchestrator.handoff(runId, body);
    publish(runId);
    return result;
  });

  /** 工具调用完成（关联平台 Run 到任务板）。 */
  app.post('/api/v1/room-runs/:runId/orchestrate/tool-completed', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      participantId: string;
      platformRunId: string;
      workItemId?: string;
      ok: boolean;
    };
    const event = orchestrator.completeToolCall(runId, body);
    publish(runId);
    return event;
  });

  /** 运行中新增任务条目（UI-10 补齐）。 */
  app.post('/api/v1/room-runs/:runId/orchestrate/work-items', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      kind: string;
      assigneeRef?: string | null;
      inputRefs?: string[];
      acceptance?: Record<string, unknown>;
    };
    const item = orchestrator.createWorkItem(runId, body);
    publish(runId);
    return item;
  });

  /** 任务板状态流转（§9.3）。 */
  app.post('/api/v1/room-runs/:runId/orchestrate/work-items/:workItemId', async (request) => {
    const { runId, workItemId } = request.params as { runId: string; workItemId: string };
    const body = request.body as { status: RoomWorkItem['status']; outputRefs?: string[] };
    return orchestrator.updateWorkItem(runId, { workItemId, ...body });
  });

  /** 结束编排（终态）。 */
  app.post('/api/v1/room-runs/:runId/orchestrate/finish', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as { status: RoomRunStatus; errorCode?: string };
    const run = orchestrator.finish(runId, body.status, { errorCode: body.errorCode });
    publish(runId);
    return run;
  });

  /** 编排状态概览（AgentSession + 任务板 + 预算用量）。 */
  app.get('/api/v1/room-runs/:runId/orchestration', async (request) => {
    const { runId } = request.params as { runId: string };
    return {
      run: roomStore.getRun(runId) ?? null,
      sessions: orchestrator.listSessions(runId),
      workItems: orchestrator.listWorkItems(runId),
    };
  });
}
