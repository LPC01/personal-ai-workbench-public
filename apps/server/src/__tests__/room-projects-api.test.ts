import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { app: ReturnType<typeof buildApp> } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-rmproj-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return { app: buildApp(db, { artifactsRoot: join(dir, 'artifacts') }) };
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

const MANIFEST = {
  schemaVersion: 'workbench.project/v1',
  project: { id: 'demo-project', name: '示例项目' },
  runtime: { root: '.' },
  commands: [
    { id: 'start-web', type: 'service', executable: 'node' },
    { id: 'run-tests', type: 'job', executable: 'npm', arguments: ['test'] },
  ],
};

async function createRoom(app: ReturnType<typeof buildApp>): Promise<void> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    payload: { name: 'R', roomType: 'sdd-delivery', manifest: { id: 'room_x' } },
  });
}

async function createRun(app: ReturnType<typeof buildApp>): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/rooms/room_x/runs',
    payload: { protocolId: 'sequential', protocolVersion: '1.0' },
  });
  return (res.json() as { id: string }).id;
}

describe('房间项目集成 API（MA-06）', () => {
  it('bindProject → listProjects 可见', async () => {
    const { app } = setup();
    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: MANIFEST });
    await createRoom(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/rooms/room_x/projects',
      payload: { projectId: 'demo-project', access: 'execute' },
    });
    const list = await app.inject({ method: 'GET', url: '/api/v1/rooms/room_x/projects' });
    expect((list.json() as { total: number }).total).toBe(1);
  });

  it('executeCommand 校验通过 → 创建平台 Run + TOOL_CALL_REQUESTED 事件', async () => {
    const { app } = setup();
    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: MANIFEST });
    await createRoom(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/rooms/room_x/projects',
      payload: { projectId: 'demo-project', access: 'execute' },
    });
    const runId = await createRun(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/commands`,
      payload: {
        roomId: 'room_x',
        projectId: 'demo-project',
        commandId: 'start-web',
        actorRef: 'builder',
        allowedTools: ['start-web'],
        requiresWrite: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { runId: string; commandRef: string };
    expect(body.commandRef).toBe('demo-project:start-web');
    expect(body.runId).toMatch(/^run_/);

    const events = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${runId}/events` });
    expect(
      (events.json() as { items: { eventType: string }[] }).items.some(
        (e) => e.eventType === 'TOOL_CALL_REQUESTED',
      ),
    ).toBe(true);
  });

  it('未绑定项目 → 403 ROOM_PROJECT_SCOPE_DENIED', async () => {
    const { app } = setup();
    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: MANIFEST });
    await createRoom(app);
    const runId = await createRun(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/commands`,
      payload: {
        roomId: 'room_x',
        projectId: 'demo-project',
        commandId: 'start-web',
        actorRef: 'builder',
        allowedTools: ['start-web'],
      },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'ROOM_PROJECT_SCOPE_DENIED',
    );
  });

  it('命令不在 ToolPolicy 允许集合 → 403 PARTICIPANT_NOT_ALLOWED', async () => {
    const { app } = setup();
    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: MANIFEST });
    await createRoom(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/rooms/room_x/projects',
      payload: { projectId: 'demo-project', access: 'execute' },
    });
    const runId = await createRun(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/commands`,
      payload: {
        roomId: 'room_x',
        projectId: 'demo-project',
        commandId: 'run-tests',
        actorRef: 'builder',
        allowedTools: ['start-web'], // 不含 run-tests
      },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('PARTICIPANT_NOT_ALLOWED');
  });

  it('recordArtifact 记录 SHA-256 + EVIDENCE_ATTACHED 事件', async () => {
    const { app } = setup();
    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: MANIFEST });
    await createRoom(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/rooms/room_x/projects',
      payload: { projectId: 'demo-project', access: 'execute' },
    });
    const roomRunId = await createRun(app);
    const cmd = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${roomRunId}/commands`,
      payload: {
        roomId: 'room_x',
        projectId: 'demo-project',
        commandId: 'start-web',
        actorRef: 'builder',
        allowedTools: ['start-web'],
      },
    });
    const { runId } = cmd.json() as { runId: string };

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${roomRunId}/artifacts`,
      payload: {
        projectId: 'demo-project',
        runId,
        kind: 'spec',
        logicalName: 'spec.md',
        content: Buffer.from('# Spec').toString('base64'),
      },
    });
    expect(res.statusCode).toBe(200);
    const artifact = res.json() as { id: string; sha256: string };
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
