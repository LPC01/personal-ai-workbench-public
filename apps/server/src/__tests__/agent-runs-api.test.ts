import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): ReturnType<typeof buildApp> {
  const dir = mkdtempSync(join(tmpdir(), 'wb-agentrunapi-'));
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

/** 注册一个 mock Harness Profile（纯内存 adapter，无需外部服务）。 */
async function registerMockProfile(app: ReturnType<typeof buildApp>): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/harness-profiles',
    payload: { id: 'hp-mock', name: 'Mock', adapterType: 'mock' },
  });
  expect(res.statusCode).toBe(200);
}

interface StartResult {
  run: { id: string; kind: string; status: string; errorCode: string | null };
  session: { id: string; runId: string; harnessProfileId: string; status: string };
}

async function startRun(
  app: ReturnType<typeof buildApp>,
  overrides: Record<string, unknown> = {},
): Promise<StartResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/agent-runs',
    payload: {
      harnessProfileId: 'hp-mock',
      modelProfileId: 'mp-1',
      prompt: '整理项目',
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as StartResult;
}

describe('agent runs API（26 SPEC §13 执行闭环接线）', () => {
  it('start 创建 kind=agent 的平台 Run 并绑定 Harness Session', async () => {
    const app = setup();
    await registerMockProfile(app);
    const { run, session } = await startRun(app);

    expect(run.kind).toBe('agent');
    expect(run.status).toBe('RUNNING');
    expect(session.runId).toBe(run.id);
    expect(session.harnessProfileId).toBe('hp-mock');
  });

  it('turn 到 SUCCEEDED，且 Run 事件可经既有 /runs 端点读取', async () => {
    const app = setup();
    await registerMockProfile(app);
    const { run, session } = await startRun(app);

    const turn = await app.inject({
      method: 'POST',
      url: `/api/v1/agent-runs/${session.id}/turns`,
      payload: { prompt: '继续' },
    });
    expect(turn.statusCode).toBe(200);
    expect((turn.json() as { run: StartResult['run'] }).run.status).toBe('SUCCEEDED');

    // 事件流复用既有 Run 端点（未新增 SSE 实现）
    const events = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/events` });
    expect(events.statusCode).toBe(200);
    const items = (events.json() as { items: { eventType: string }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((e) => e.eventType === 'state')).toBe(true);
  });

  it('resume 返回会话 + 游标之后的 Run 事件', async () => {
    const app = setup();
    await registerMockProfile(app);
    const { run, session } = await startRun(app);

    const resumed = await app.inject({ method: 'GET', url: `/api/v1/agent-runs/${session.id}` });
    expect(resumed.statusCode).toBe(200);
    const body = resumed.json() as {
      session: { id: string };
      run: { id: string };
      events: { sequence: number }[];
    };
    expect(body.session.id).toBe(session.id);
    expect(body.run.id).toBe(run.id);
    expect(body.events.length).toBeGreaterThan(0);
  });

  it('cancel 转 CANCELLED 并同步 Session 状态', async () => {
    const app = setup();
    await registerMockProfile(app);
    const { session } = await startRun(app);

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/agent-runs/${session.id}/cancel`,
      payload: {},
    });
    expect(cancel.statusCode).toBe(200);
    expect((cancel.json() as { run: StartResult['run'] }).run.status).toBe('CANCELLED');

    const resumed = await app.inject({ method: 'GET', url: `/api/v1/agent-runs/${session.id}` });
    expect((resumed.json() as { session: { status: string } }).session.status).toBe('cancelled');
  });

  it('start 对不存在的 harnessProfileId 返回 404', async () => {
    const app = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-runs',
      payload: { harnessProfileId: 'nope', modelProfileId: 'mp-1', prompt: 'x' },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'HARNESS_PROFILE_NOT_FOUND',
    );
  });

  it('turn 对不存在的 sessionId 返回 404', async () => {
    const app = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-runs/hses_nope/turns',
      payload: { prompt: 'x' },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'HARNESS_SESSION_NOT_FOUND',
    );
  });

  it('拒绝非法工具 ID（422）与缺失 prompt（422）', async () => {
    const app = setup();
    await registerMockProfile(app);

    const badTool = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-runs',
      payload: {
        harnessProfileId: 'hp-mock',
        modelProfileId: 'mp-1',
        prompt: 'x',
        toolPolicy: { allowedToolIds: ['shell.exec'] },
      },
    });
    expect(badTool.statusCode).toBe(422);
    expect((badTool.json() as { error: { code: string } }).error.code).toBe(
      'COMMAND_ARGUMENT_INVALID',
    );

    const noPrompt = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-runs',
      payload: { harnessProfileId: 'hp-mock', modelProfileId: 'mp-1' },
    });
    expect(noPrompt.statusCode).toBe(422);
  });

  it('合法工具策略被接受（工具回环由 execution-gateway 单测覆盖）', async () => {
    const app = setup();
    await registerMockProfile(app);
    const { run } = await startRun(app, {
      toolPolicy: {
        allowedToolIds: ['project.describe', 'run.status'],
        constraints: { 'project.command.run': { commandIds: ['build'] } },
      },
    });
    expect(run.status).toBe('RUNNING');
  });

  it('deepseek profile 缺 baseUrl 时 start 返回 503（不再静默指向默认地址）', async () => {
    const app = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/harness-profiles',
      payload: { id: 'hp-bad', name: 'Bad', adapterType: 'deepseek', config: {} },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-runs',
      payload: { harnessProfileId: 'hp-bad', modelProfileId: 'mp-1', prompt: 'x' },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('HARNESS_UNAVAILABLE');
  });
});
