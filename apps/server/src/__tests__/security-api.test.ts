import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations, RunStore } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { app: ReturnType<typeof buildApp>; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-sec-'));
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

describe('RoomRun 取消传播（MA-09 ROOM-SEC-007）', () => {
  it('cancel 向子 Run 传播取消', async () => {
    const { app, db } = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: { name: 'R', roomType: 'sdd-delivery', manifest: { id: 'room_x' } },
    });
    const runRes = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms/room_x/runs',
      payload: { protocolId: 'sequential', protocolVersion: '1.0' },
    });
    const roomRunId = (runRes.json() as { id: string }).id;
    db.prepare('UPDATE room_runs SET status = ? WHERE id = ?').run('RUNNING', roomRunId);

    // 创建子 Run（CREATED → VALIDATING → QUEUED，可取消状态）
    const runStore = new RunStore(db);
    const child = runStore.createRun({
      kind: 'builder',
      commandRef: 'p1:cmd',
      input: { roomRunId },
    });
    runStore.transitionRun(child.id, 'VALIDATING');
    runStore.transitionRun(child.id, 'QUEUED');

    await app.inject({ method: 'POST', url: `/api/v1/room-runs/${roomRunId}/cancel` });

    const after = runStore.getRun(child.id);
    expect(after?.status).toBe('CANCELLED');
  });
});
