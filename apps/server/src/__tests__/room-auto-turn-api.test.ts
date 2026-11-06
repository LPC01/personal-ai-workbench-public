import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { app: ReturnType<typeof buildApp>; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-autoturn-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return { app: buildApp(db), db };
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

const LIMITS = {
  maxTurns: 20,
  maxDurationSeconds: 3600,
  maxTotalTokens: 200_000,
  maxCost: 10,
  noProgressTurns: 3,
};

/** 建房间 + Run + 可编程 mock harness（script 提供确定内容，无需真实模型）。 */
async function seed(
  app: ReturnType<typeof buildApp>,
  script: string[],
): Promise<{ roomId: string; runId: string; harnessId: string }> {
  const harnessId = `harness-mock-${Math.random().toString(36).slice(2, 8)}`;
  const h = await app.inject({
    method: 'POST',
    url: '/api/v1/harness-profiles',
    payload: {
      id: harnessId,
      name: 'Mock',
      adapterType: 'mock',
      config: { script: script.map((content) => ({ content, stopReason: 'end' })) },
    },
  });
  expect(h.statusCode).toBeLessThan(400);

  await app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    payload: { name: 'R', roomType: 'sdd-delivery', manifest: { id: 'room_x' } },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/rooms/room_x/runs',
    payload: { protocolId: 'sequential', protocolVersion: '1.0' },
  });
  return { roomId: 'room_x', runId: (res.json() as { id: string }).id, harnessId };
}

async function startOrchestration(
  app: ReturnType<typeof buildApp>,
  runId: string,
  harnessId: string,
  limits = LIMITS,
): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/room-runs/${runId}/orchestrate/start`,
    payload: {
      participants: [
        {
          participantId: 'pm',
          harnessProfileId: harnessId,
          modelBinding: { modelProfileId: 'mp-1', revision: 1 },
          toolPolicy: { allowedTools: [] },
          systemInstruction: '你是产品经理，只写需求要点。',
        },
        {
          participantId: 'dev',
          harnessProfileId: harnessId,
          modelBinding: { modelProfileId: 'mp-1', revision: 1 },
          toolPolicy: { allowedTools: [] },
          systemInstruction: '你是开发，只写实现要点。',
        },
      ],
      limits,
    },
  });
  expect(res.statusCode).toBeLessThan(400);
}

describe('聊天室自动轮次 API（UI-10）', () => {
  it('一次请求推进 2 位参与者真实发言，写 AGENT_MESSAGE 并累计用量', async () => {
    const { app } = setup();
    const { runId, harnessId } = await seed(app, ['需求要点：先做登录', '实现要点：加路由']);
    await startOrchestration(app, runId, harnessId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/auto-turn`,
      payload: { content: '请开始协作', rounds: 2 },
    });
    expect(res.statusCode).toBeLessThan(400);
    const body = res.json() as {
      turns: { participantId: string; status: string; content: string; tokens: number }[];
      stoppedReason: string | null;
      run: { usage: { turns: number } };
    };
    expect(body.stoppedReason).toBeNull();
    expect(body.turns).toHaveLength(2);
    expect(body.turns.map((t) => t.participantId)).toEqual(['pm', 'dev']);
    expect(body.turns.every((t) => t.status === 'SUCCEEDED')).toBe(true);
    expect(body.turns[0]?.content).toBe('需求要点：先做登录');
    expect(body.turns[1]?.content).toBe('实现要点：加路由');
    expect(body.turns[0]?.tokens).toBeGreaterThan(0);
    expect(body.run.usage.turns).toBe(2);

    const events = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${runId}/events` });
    const items = (events.json() as { items: { eventType: string; actorRef: string }[] }).items;
    expect(items.filter((e) => e.eventType === 'USER_MESSAGE')).toHaveLength(1);
    const agentMsgs = items.filter((e) => e.eventType === 'AGENT_MESSAGE');
    expect(agentMsgs.map((e) => e.actorRef)).toEqual(['pm', 'dev']);
  });

  it('不指定发言人时按轮询顺序推进（第二次从 dev 开始）', async () => {
    const { app } = setup();
    const { runId, harnessId } = await seed(app, ['A1', 'B1', 'A2']);
    await startOrchestration(app, runId, harnessId);

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/auto-turn`,
      payload: { content: '开始' },
    });
    expect((first.json() as { turns: { participantId: string }[] }).turns[0]?.participantId).toBe(
      'pm',
    );

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/auto-turn`,
      payload: {},
    });
    expect((second.json() as { turns: { participantId: string }[] }).turns[0]?.participantId).toBe(
      'dev',
    );
  });

  it('可人工指定发言人（优先于轮询）', async () => {
    const { app } = setup();
    const { runId, harnessId } = await seed(app, ['X1']);
    await startOrchestration(app, runId, harnessId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/auto-turn`,
      payload: { participantId: 'dev' },
    });
    expect((res.json() as { turns: { participantId: string }[] }).turns[0]?.participantId).toBe(
      'dev',
    );
  });

  it('预算超限：第二轮被拦下，Run 进入 BUDGET_EXCEEDED 且不产生新模型调用', async () => {
    const { app } = setup();
    const { runId, harnessId } = await seed(app, ['A1', 'B1']);
    await startOrchestration(app, runId, harnessId, { ...LIMITS, maxTurns: 1 });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/auto-turn`,
      payload: { content: '开始', rounds: 2 },
    });
    const body = res.json() as { turns: unknown[]; stoppedReason: string | null };
    expect(body.stoppedReason).toBe('ROOM_BUDGET_EXCEEDED');
    expect(body.turns).toHaveLength(1);

    const run = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${runId}` });
    expect((run.json() as { status: string }).status).toBe('BUDGET_EXCEEDED');
  });

  it('模型侧空产出：不伪造内容，如实返回 FAILED/NO_CONTENT', async () => {
    const { app } = setup();
    // 空脚本 → MockHarnessAdapter 返回空 content
    const { runId, harnessId } = await seed(app, []);
    await startOrchestration(app, runId, harnessId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/auto-turn`,
      payload: { content: '开始' },
    });
    const body = res.json() as {
      turns: { status: string; errorCode?: string }[];
      stoppedReason: string | null;
    };
    expect(body.turns[0]?.status).toBe('FAILED');
    expect(body.stoppedReason).toBeTruthy();

    const events = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${runId}/events` });
    const items = (events.json() as { items: { eventType: string }[] }).items;
    expect(items.some((e) => e.eventType === 'AGENT_MESSAGE')).toBe(false);
  });

  it('编排未启动时返回 PARTICIPANT_NOT_ALLOWED（不静默假装发言）', async () => {
    const { app, db } = setup();
    const { runId } = await seed(app, ['A1']);
    db.prepare('UPDATE room_runs SET status = ? WHERE id = ?').run('RUNNING', runId);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/auto-turn`,
      payload: { content: '开始' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('PARTICIPANT_NOT_ALLOWED');
  });

  it('启动编排时非法工具 ID 被拒绝（不静默降级）', async () => {
    const { app } = setup();
    const { runId, harnessId } = await seed(app, ['A1']);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/orchestrate/start`,
      payload: {
        participants: [
          {
            participantId: 'pm',
            harnessProfileId: harnessId,
            modelBinding: { modelProfileId: 'mp-1', revision: 1 },
            toolPolicy: { allowedTools: ['rm -rf /'] },
          },
        ],
        limits: LIMITS,
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('COMMAND_ARGUMENT_INVALID');
  });

  it('启动后参与者快照含 harnessSessionId（自动轮次的持久化绑定）', async () => {
    const { app } = setup();
    const { runId, harnessId } = await seed(app, ['A1']);
    await startOrchestration(app, runId, harnessId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/room-runs/${runId}/orchestration`,
    });
    const sessions = (
      res.json() as { sessions: { agentProfileSnapshot: Record<string, unknown> }[] }
    ).sessions;
    expect(sessions).toHaveLength(2);
    for (const s of sessions) {
      expect(typeof s.agentProfileSnapshot.harnessSessionId).toBe('string');
      expect(String(s.agentProfileSnapshot.harnessSessionId).startsWith('hses_')).toBe(true);
    }
  });
});
