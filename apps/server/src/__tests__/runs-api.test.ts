import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations, RunStore } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function tmpDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'wb-runs-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return db;
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

describe('runs API', () => {
  it('lists runs', async () => {
    const db = tmpDb();
    const store = new RunStore(db);
    store.createRun({ kind: 'job' });
    store.createRun({ kind: 'workflow' });

    const app = buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/api/v1/runs' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { total: number }).total).toBe(2);
  });

  it('gets a single run', async () => {
    const db = tmpDb();
    const store = new RunStore(db);
    const run = store.createRun({ kind: 'job' });

    const app = buildApp(db);
    const res = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { id: string }).id).toBe(run.id);
  });

  it('returns 404 for a missing run detail', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/api/v1/runs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('lists run events', async () => {
    const db = tmpDb();
    const store = new RunStore(db);
    const run = store.createRun({ kind: 'job' });
    store.appendRunEvent(run.id, 'state', { from: 'CREATED' });
    store.appendRunEvent(run.id, 'log', { msg: 'hi' });

    const app = buildApp(db);
    const res = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/events` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { sequence: number }[]; total: number };
    expect(body.total).toBe(2);
    expect(body.items.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('lists run events after a sequence (incremental)', async () => {
    const db = tmpDb();
    const store = new RunStore(db);
    const run = store.createRun({ kind: 'job' });
    store.appendRunEvent(run.id, 'state', { from: 'CREATED' });
    store.appendRunEvent(run.id, 'state', { from: 'VALIDATING' });

    const app = buildApp(db);
    const res = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/events?after=1` });
    const body = res.json() as { items: { sequence: number }[] };
    expect(body.items.map((e) => e.sequence)).toEqual([2]);
  });

  it('replays SSE frames and closes on terminal run', async () => {
    const db = tmpDb();
    const store = new RunStore(db);
    const run = store.createRun({ kind: 'job' });
    store.transitionRun(run.id, 'VALIDATING');
    store.transitionRun(run.id, 'QUEUED');
    store.transitionRun(run.id, 'STARTING');
    store.transitionRun(run.id, 'RUNNING');
    store.appendRunEvent(run.id, 'state', { from: 'RUNNING' });
    store.transitionRun(run.id, 'SUCCEEDED');

    const app = buildApp(db);
    const res = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/stream` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('id: 1');
    expect(res.body).toContain('event: state');
  });

  it('returns 404 for a missing run', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/api/v1/runs/nope/stream' });
    expect(res.statusCode).toBe(404);
  });

  it('cancels a queued run', async () => {
    const db = tmpDb();
    const store = new RunStore(db);
    const run = store.createRun({ kind: 'job' });
    store.transitionRun(run.id, 'VALIDATING');
    store.transitionRun(run.id, 'QUEUED');

    const app = buildApp(db);
    const res = await app.inject({ method: 'POST', url: `/api/v1/runs/${run.id}/cancel` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('CANCELLED');
  });

  it('returns 409 when cancelling a terminal run', async () => {
    const db = tmpDb();
    const store = new RunStore(db);
    const run = store.createRun({ kind: 'job' });
    store.transitionRun(run.id, 'VALIDATING');
    store.transitionRun(run.id, 'FAILED');

    const app = buildApp(db);
    const res = await app.inject({ method: 'POST', url: `/api/v1/runs/${run.id}/cancel` });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('RUN_NOT_CANCELABLE');
  });
});
