import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  ArtifactStore,
  migrations,
  openConnection,
  runMigrations,
  RunStore,
} from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { app: ReturnType<typeof buildApp>; db: Database.Database; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-overview-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const app = buildApp(db, { artifactsRoot: join(dir, 'artifacts') });
  return { app, db, dir };
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

const manifest = {
  schemaVersion: 'workbench.project/v1',
  project: { id: 'demo-project', name: '示例项目' },
  runtime: { root: '.' },
  commands: [{ id: 'start-web', type: 'service', executable: 'node' }],
};

describe('Overview API（P8-01 全局搜索/摘要/时间线）', () => {
  it('summary 返回项目/Run/Artifact 计数', async () => {
    const { app, db, dir } = setup();
    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: manifest });
    const run = new RunStore(db).createRun({ kind: 'job', projectId: 'demo-project' });
    new ArtifactStore(db, join(dir, 'artifacts')).create({
      runId: run.id,
      kind: 'report',
      logicalName: '示例业务摘要',
      content: Buffer.from('hello'),
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/overview/summary' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { projects: number; runs: { total: number }; artifacts: number };
    expect(body.projects).toBe(1);
    expect(body.runs.total).toBe(1);
    expect(body.artifacts).toBe(1);
  });

  it('search 跨项目/跨 Run/跨 Artifact 命中', async () => {
    const { app, db, dir } = setup();
    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: manifest });
    const run = new RunStore(db).createRun({
      kind: 'job',
      projectId: 'demo-project',
      commandRef: 'build-report',
    });
    new ArtifactStore(db, join(dir, 'artifacts')).create({
      runId: run.id,
      kind: 'report',
      logicalName: '示例业务月度摘要',
      content: Buffer.from('hello'),
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/overview/search?q=demo' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      projects: unknown[];
      runs: unknown[];
      artifacts: { logicalName: string }[];
    };
    expect(body.projects).toHaveLength(1);
    expect(body.runs).toHaveLength(0); // commandRef=build-report 不含 'demo'
    expect(body.artifacts).toHaveLength(0);

    const res2 = await app.inject({ method: 'GET', url: '/api/v1/overview/search?q=示例业务' });
    const body2 = res2.json() as { artifacts: { logicalName: string }[] };
    expect(body2.artifacts).toHaveLength(1);
    expect(body2.artifacts[0]?.logicalName).toBe('示例业务月度摘要');
  });

  it('timeline 按时间倒序合并 Run 与 Artifact', async () => {
    const { app, db, dir } = setup();
    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: manifest });
    const run = new RunStore(db).createRun({ kind: 'workflow', projectId: 'demo-project' });
    new ArtifactStore(db, join(dir, 'artifacts')).create({
      runId: run.id,
      kind: 'report',
      logicalName: '蓝图',
      content: Buffer.from('x'),
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/overview/timeline' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { kind: string }[];
    expect(body).toHaveLength(2);
    const kinds = body.map((e) => e.kind).sort();
    expect(kinds).toEqual(['artifact', 'run']);
  });
});
