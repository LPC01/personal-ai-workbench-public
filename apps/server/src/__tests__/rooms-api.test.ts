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
  const dir = mkdtempSync(join(tmpdir(), 'wb-roomapi-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return { app: buildApp(db) };
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

describe('聊天室 API（MA-02）', () => {
  it('创建 Room → activate → 列表可见', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: {
        name: 'SDD 交付室',
        roomType: 'sdd-delivery',
        manifest: { id: 'room_x', name: 'SDD 交付室' },
      },
    });
    expect(res.statusCode).toBe(200);
    const room = res.json() as { id: string; status: string; manifestHash: string };
    expect(room.id).toBe('room_x');
    expect(room.status).toBe('DRAFT');
    expect(room.manifestHash).toMatch(/^[0-9a-f]{64}$/);

    const act = await app.inject({ method: 'POST', url: '/api/v1/rooms/room_x/activate' });
    expect((act.json() as { status: string }).status).toBe('ACTIVE');
  });

  it('创建 Run → ROOM_RUN_CREATED 事件 + 消息追加 sequence 递增', async () => {
    const { app } = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: { name: 'SDD 交付室', roomType: 'sdd-delivery', manifest: { id: 'room_x' } },
    });
    const runRes = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms/room_x/runs',
      payload: { protocolId: 'sequential', protocolVersion: '1.0' },
    });
    const run = runRes.json() as { id: string };
    expect(runRes.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${run.id}/messages`,
      payload: { actorRef: 'user', content: '请设计数据交换模块' },
    });

    const events = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${run.id}/events` });
    const body = events.json() as { items: { sequence: number; eventType: string }[] };
    expect(body.items.map((e) => e.eventType)).toEqual(['ROOM_RUN_CREATED', 'USER_MESSAGE']);
    expect(body.items.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('事件回放支持 after 参数（重连从下一 sequence）', async () => {
    const { app } = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: { name: 'SDD 交付室', roomType: 'sdd-delivery', manifest: { id: 'room_x' } },
    });
    const run = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/rooms/room_x/runs',
        payload: { protocolId: 'sequential', protocolVersion: '1.0' },
      })
    ).json() as { id: string };
    await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${run.id}/messages`,
      payload: { actorRef: 'user', content: 'hi' },
    });

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/room-runs/${run.id}/events?after=1`,
    });
    const items = (after.json() as { items: { sequence: number }[] }).items;
    expect(items.map((e) => e.sequence)).toEqual([2]);
  });

  it('不存在的 Room 返回 404 ROOM_NOT_FOUND', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/rooms/nope' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ROOM_NOT_FOUND');
  });
});
