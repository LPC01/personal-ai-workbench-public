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
  const dir = mkdtempSync(join(tmpdir(), 'wb-diag-'));
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

interface DiagBody {
  status: string;
  version: string;
  checks: { name: string; status: string }[];
  summary: { schemaVersion: number; projects: number; modelProviders: number; totalRuns: number };
}

describe('Diagnostics API（P8-03 一键健康检查）', () => {
  it('返回 ok + database/schema/memory 检查 + 汇总', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/diagnostics' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as DiagBody;
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    const names = body.checks.map((c) => c.name).sort();
    expect(names).toEqual(['database', 'memory', 'schema']);
    expect(body.checks.every((c) => c.status === 'ok')).toBe(true);
    const maxVersion = Math.max(...migrations.map((m) => m.version));
    expect(body.summary.schemaVersion).toBe(maxVersion);
    expect(body.summary.projects).toBe(0);
  });

  it('注册项目后汇总 projects 计数更新', async () => {
    const { app } = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: {
        schemaVersion: 'workbench.project/v1',
        project: { id: 'demo-project', name: '示例项目' },
        runtime: { root: '.' },
        commands: [{ id: 'start-web', type: 'service', executable: 'node' }],
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/diagnostics' });
    const body = res.json() as DiagBody;
    expect(body.summary.projects).toBe(1);
  });
});
