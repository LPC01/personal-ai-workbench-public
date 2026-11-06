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
  const dir = mkdtempSync(join(tmpdir(), 'wb-harnessapi-'));
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

describe('harness profiles API', () => {
  it('creates and lists a DeepSeek Harness profile', async () => {
    const app = setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/harness-profiles',
      payload: {
        id: 'deepseek-harness-local',
        name: 'DeepSeek Harness',
        adapterType: 'deepseek',
        config: { baseUrl: 'http://127.0.0.1:8123' },
      },
    });
    expect(created.statusCode).toBe(200);
    expect((created.json() as { revision: number }).revision).toBe(1);

    const list = await app.inject({ method: 'GET', url: '/api/v1/harness-profiles' });
    expect((list.json() as { total: number }).total).toBe(1);
  });

  it('probe 对不可达 Harness 返回 ok:false（降级不抛 500）', async () => {
    const app = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/harness-profiles',
      payload: {
        id: 'down',
        name: 'Down',
        adapterType: 'deepseek',
        config: { baseUrl: 'http://127.0.0.1:1', timeoutSeconds: 1 },
      },
    });
    const probe = await app.inject({ method: 'POST', url: '/api/v1/harness-profiles/down/probe' });
    expect(probe.statusCode).toBe(200);
    expect((probe.json() as { health: { ok: boolean } }).health.ok).toBe(false);
  });

  it('probe 对不存在的 profile 返回 404', async () => {
    const app = setup();
    const probe = await app.inject({ method: 'POST', url: '/api/v1/harness-profiles/nope/probe' });
    expect(probe.statusCode).toBe(404);
  });
});
