import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

/**
 * Room Orchestrator 运行时集成测试（29 SPEC §9.2 生命周期 / §12 调度 / §21 预算）。
 *
 * 与 `orchestration-api.test.ts`（RoomService 的 pause/resume/cancel）互补：
 * 本文件走真实 HTTP（Fastify inject + 真实 SQLite + 真实 RoomStore/AgentSessionStore），
 * 覆盖 `@workbench/room-orchestrator` 在 app 层的完整接线 ——
 * 启动 → 发言调度 → Handoff → 工具完成 → 任务板 → 结束，以及策略/预算/状态门禁。
 */

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): ReturnType<typeof buildApp> {
  const dir = mkdtempSync(join(tmpdir(), 'wb-orchrt-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return buildApp(db);
}

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()?.close();
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const PARTICIPANTS = [
  {
    participantId: 'planner',
    agentProfileSnapshot: { id: 'planner', role: 'PLANNER' },
    modelBinding: { modelProfileId: 'mp-fast', revision: 1 },
    toolPolicy: { allowedTools: ['read'] },
  },
  {
    participantId: 'reviewer',
    agentProfileSnapshot: { id: 'reviewer', role: 'REVIEWER' },
    modelBinding: { modelProfileId: 'mp-strong', revision: 1 },
    toolPolicy: { allowedTools: ['read'] },
  },
];

function limits(maxTurns = 10): Record<string, number> {
  return {
    maxTurns,
    maxDurationSeconds: 600,
    maxTotalTokens: 100_000,
    maxCost: 5,
    noProgressTurns: 3,
  };
}

async function seedRoomRun(
  app: ReturnType<typeof buildApp>,
): Promise<{ roomId: string; runId: string }> {
  const room = await app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    payload: { name: '编排室', roomType: 'work', manifest: { id: 'room-orchrt' } },
  });
  const roomId = (room.json() as { id: string }).id;
  const run = await app.inject({
    method: 'POST',
    url: `/api/v1/rooms/${roomId}/runs`,
    payload: { protocolId: 'sequential', protocolVersion: '1.0.0' },
  });
  return { roomId, runId: (run.json() as { id: string }).id };
}

describe('Room Orchestrator 运行时（编排接线）', () => {
  it('启动 → 发言 → Handoff → 工具完成 → 任务板 → 结束全链路', async () => {
    const app = setup();
    const { roomId, runId } = await seedRoomRun(app);

    // 启动编排：建立 AgentSession、固定协议预算、初始化共享任务板
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/start`,
      payload: {
        participants: PARTICIPANTS,
        limits: limits(),
        workItems: [{ kind: 'analyze', assigneeRef: 'planner' }],
      },
    });
    expect(started.statusCode).toBe(200);
    const startBody = started.json() as {
      run: { status: string };
      sessions: { participantId: string }[];
      workItems: { id: string; status: string }[];
    };
    expect(startBody.run.status).toBe('RUNNING');
    expect(startBody.sessions.map((s) => s.participantId).sort()).toEqual(['planner', 'reviewer']);
    expect(startBody.workItems).toHaveLength(1);
    const workItemId = startBody.workItems[0]?.id as string;
    expect(startBody.workItems[0]?.status).toBe('OPEN');

    // 发言调度：候选集合内参与者 → 写 AGENT_TURN_STARTED + AGENT_MESSAGE
    const turn = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/turn`,
      payload: {
        participantId: 'planner',
        allowedParticipants: ['planner', 'reviewer'],
        content: '先拆解任务',
        tokens: 120,
      },
    });
    expect(turn.statusCode).toBe(200);
    expect((turn.json() as { event: { eventType: string } }).event.eventType).toBe('AGENT_MESSAGE');

    // 候选集合外参与者被拒绝（§12.1 策略门禁）→ 403
    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/turn`,
      payload: {
        participantId: 'planner',
        allowedParticipants: ['reviewer'],
        content: '越权发言',
      },
    });
    expect(denied.statusCode).toBe(403);
    expect((denied.json() as { error: { code: string } }).error.code).toBe(
      'PARTICIPANT_NOT_ALLOWED',
    );

    // 没有 AgentSession 的参与者被拒绝（§7.1 会话隔离）→ 403
    const ghost = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/turn`,
      payload: {
        participantId: 'ghost',
        allowedParticipants: ['planner', 'reviewer', 'ghost'],
        content: '无会话',
      },
    });
    expect(ghost.statusCode).toBe(403);

    // Handoff：指派任务板并置 ASSIGNED（§12.2）
    const handoff = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/handoff`,
      payload: {
        handoff: {
          toParticipantId: 'reviewer',
          workItemId,
          objective: '复核拆解结果',
          inputRefs: ['artifact:plan'],
          acceptance: ['结论可追溯'],
          reason: '需要独立复核',
        },
        allowedParticipants: ['planner', 'reviewer'],
      },
    });
    expect(handoff.statusCode).toBe(200);
    expect(
      (handoff.json() as { workItem: { status: string; assigneeRef: string } }).workItem.status,
    ).toBe('ASSIGNED');

    // Handoff 目标不在允许集合 → 403
    const badHandoff = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/handoff`,
      payload: {
        handoff: {
          toParticipantId: 'outsider',
          workItemId,
          objective: 'x',
          inputRefs: [],
          acceptance: [],
          reason: 'y',
        },
        allowedParticipants: ['planner', 'reviewer'],
      },
    });
    expect(badHandoff.statusCode).toBe(403);

    // 工具调用完成：关联平台 Run，任务板置 SUBMITTED
    const toolDone = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/tool-completed`,
      payload: { participantId: 'reviewer', platformRunId: 'run_platform_1', workItemId, ok: true },
    });
    expect(toolDone.statusCode).toBe(200);
    expect((toolDone.json() as { eventType: string }).eventType).toBe('TOOL_CALL_COMPLETED');

    // 任务板状态流转 → ACCEPTED
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/work-items/${workItemId}`,
      payload: { status: 'ACCEPTED', outputRefs: ['run_platform_1'] },
    });
    expect((accepted.json() as { status: string }).status).toBe('ACCEPTED');

    // 编排概览：Session + 任务板 + 预算用量
    const overview = await app.inject({
      method: 'GET',
      url: `/api/v1/room-runs/${runId}/orchestration`,
    });
    const overviewBody = overview.json() as {
      run: { usage: { turns: number; totalTokens: number } };
      sessions: unknown[];
      workItems: { status: string }[];
    };
    expect(overviewBody.sessions).toHaveLength(2);
    expect(overviewBody.workItems[0]?.status).toBe('ACCEPTED');
    expect(overviewBody.run.usage.turns).toBe(1);
    expect(overviewBody.run.usage.totalTokens).toBe(120);

    // 结束（终态 SUCCEEDED）→ 追加 ROOM_RUN_COMPLETED
    const finished = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/finish`,
      payload: { status: 'SUCCEEDED' },
    });
    expect(finished.statusCode).toBe(200);
    expect((finished.json() as { status: string }).status).toBe('SUCCEEDED');

    const events = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${runId}/events` });
    const types = (events.json() as { items: { eventType: string }[] }).items.map(
      (e) => e.eventType,
    );
    expect(types).toContain('CONTEXT_SNAPSHOT_CREATED');
    expect(types).toContain('TASK_ASSIGNED');
    expect(types).toContain('HANDOFF_COMPLETED');
    expect(types).toContain('TOOL_CALL_COMPLETED');
    expect(types).toContain('ROOM_RUN_COMPLETED');

    // #8：按房间列出 Run（含本次协作 Run）
    const roomRuns = await app.inject({ method: 'GET', url: `/api/v1/rooms/${roomId}/runs` });
    const roomRunIds = (roomRuns.json() as { items: { id: string }[] }).items.map((r) => r.id);
    expect(roomRunIds).toContain(runId);
  });

  it('预算超限：达到 maxTurns 后进入 BUDGET_EXCEEDED 并拒绝派发（§21）', async () => {
    const app = setup();
    const { runId } = await seedRoomRun(app);
    await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/start`,
      payload: { participants: PARTICIPANTS, limits: limits(2) },
    });

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/turn`,
      payload: {
        participantId: 'planner',
        allowedParticipants: ['planner', 'reviewer'],
        content: 't1',
      },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/turn`,
      payload: {
        participantId: 'reviewer',
        allowedParticipants: ['planner', 'reviewer'],
        content: 't2',
      },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe('ROOM_BUDGET_EXCEEDED');

    const run = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${runId}` });
    expect((run.json() as { status: string }).status).toBe('BUDGET_EXCEEDED');
  });

  it('不存在的 Run 启动编排 → 404', async () => {
    const app = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/room-runs/roomrun_missing/orchestrate/start',
      payload: { participants: PARTICIPANTS, limits: limits() },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ROOM_RUN_NOT_FOUND');
  });

  it('已运行的 Run 重复启动 → 409 状态冲突', async () => {
    const app = setup();
    const { runId } = await seedRoomRun(app);
    await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/start`,
      payload: { participants: PARTICIPANTS, limits: limits() },
    });
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/start`,
      payload: { participants: PARTICIPANTS, limits: limits() },
    });
    expect(again.statusCode).toBe(409);
    expect((again.json() as { error: { code: string } }).error.code).toBe(
      'ROOM_RUN_STATE_CONFLICT',
    );
  });
});
