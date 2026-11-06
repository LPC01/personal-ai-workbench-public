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
  const dir = mkdtempSync(join(tmpdir(), 'wb-orch-'));
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

async function seedRun(app: ReturnType<typeof buildApp>, db: Database.Database): Promise<string> {
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
  const runId = (res.json() as { id: string }).id;
  db.prepare('UPDATE room_runs SET status = ? WHERE id = ?').run('RUNNING', runId);
  return runId;
}

describe('RoomRun 编排 API（MA-04 pause/resume/cancel）', () => {
  it('RUNNING → pause → PAUSED → resume → RUNNING', async () => {
    const { app, db } = setup();
    const runId = await seedRun(app, db);

    const paused = await app.inject({ method: 'POST', url: `/api/v1/room-runs/${runId}/pause` });
    expect((paused.json() as { status: string }).status).toBe('PAUSED');

    const resumed = await app.inject({ method: 'POST', url: `/api/v1/room-runs/${runId}/resume` });
    expect((resumed.json() as { status: string }).status).toBe('RUNNING');
  });

  it('RUNNING → cancel → CANCELLING（异步取消路径）', async () => {
    const { app, db } = setup();
    const runId = await seedRun(app, db);

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/cancel`,
    });
    expect((cancelled.json() as { status: string }).status).toBe('CANCELLING');
  });

  it('非法转换返回 409 ROOM_RUN_STATE_CONFLICT', async () => {
    const { app, db } = setup();
    const runId = await seedRun(app, db);

    // CREATED 状态不能 pause（需 RUNNING）——直接用 db 设 CREATED
    db.prepare('UPDATE room_runs SET status = ? WHERE id = ?').run('CREATED', runId);
    const res = await app.inject({ method: 'POST', url: `/api/v1/room-runs/${runId}/pause` });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ROOM_RUN_STATE_CONFLICT');
  });

  it('pause 追加 ROOM_RUN_PAUSED 事件', async () => {
    const { app, db } = setup();
    const runId = await seedRun(app, db);

    await app.inject({ method: 'POST', url: `/api/v1/room-runs/${runId}/pause` });
    const events = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${runId}/events` });
    const items = (events.json() as { items: { eventType: string }[] }).items;
    expect(items.some((e) => e.eventType === 'ROOM_RUN_PAUSED')).toBe(true);
  });
});
