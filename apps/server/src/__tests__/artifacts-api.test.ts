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

function setup(): {
  db: Database.Database;
  artifactStore: ArtifactStore;
  runId: string;
  root: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'wb-artapi-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const runId = new RunStore(db).createRun({ kind: 'job' }).id;
  const root = join(dir, 'artifacts');
  return { db, artifactStore: new ArtifactStore(db, root), runId, root };
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

describe('artifacts API', () => {
  it('lists artifacts for a run', async () => {
    const { db, artifactStore, runId, root } = setup();
    artifactStore.create({ runId, kind: 'report', logicalName: 'a.md', content: Buffer.from('a') });

    const app = buildApp(db, { artifactsRoot: root });
    const res = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}/artifacts` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { total: number }).total).toBe(1);
  });

  it('downloads an artifact with its content', async () => {
    const { db, artifactStore, runId, root } = setup();
    const art = artifactStore.create({
      runId,
      kind: 'report',
      logicalName: 'out.md',
      mediaType: 'text/markdown',
      content: Buffer.from('# hello'),
    });

    const app = buildApp(db, { artifactsRoot: root });
    const res = await app.inject({ method: 'GET', url: `/api/v1/artifacts/${art.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.body).toBe('# hello');
  });

  it('returns 404 for a missing artifact', async () => {
    const { db, root } = setup();
    const app = buildApp(db, { artifactsRoot: root });
    const res = await app.inject({ method: 'GET', url: '/api/v1/artifacts/nope' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ARTIFACT_NOT_FOUND');
  });
});
