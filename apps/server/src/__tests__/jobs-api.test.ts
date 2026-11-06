import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { ProjectManifest } from '@workbench/contracts';
import { migrations, openConnection, runMigrations, RunStore } from '@workbench/persistence';
import { ProjectCatalog } from '@workbench/project-runtime';
import { buildApp } from '../app.js';

const NODE = process.execPath;
const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/integration/fixtures/sample-job',
);

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function manifest(): ProjectManifest {
  return {
    schemaVersion: 'workbench.project/v1',
    project: { id: 'job-proj', name: 'Job 项目' },
    runtime: { root: FIXTURE },
    commands: [
      { id: 'ok', type: 'job', executable: NODE, arguments: ['success.js'] },
      { id: 'fail', type: 'job', executable: NODE, arguments: ['fail.js'] },
      { id: 'long', type: 'job', executable: NODE, arguments: ['long.js'] },
      { id: 'svc', type: 'service', executable: NODE, arguments: ['success.js'] },
    ],
  };
}

function setup(): { db: Database.Database; store: RunStore; app: ReturnType<typeof buildApp> } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-jobsapi-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  new ProjectCatalog(db).register(manifest());
  return { db, store: new RunStore(db), app: buildApp(db) };
}

async function waitForTerminal(store: RunStore, runId: string, timeoutMs = 8000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = store.getRun(runId)?.status;
    if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED') {
      return status;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('run did not reach terminal within timeout');
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

describe('jobs API', () => {
  it('starts a job run and reaches SUCCEEDED', async () => {
    const { app, store } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/job-proj/commands/ok/runs',
    });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { id: string; status: string };
    expect(run.status).toBe('RUNNING');

    expect(await waitForTerminal(store, run.id)).toBe('SUCCEEDED');
  });

  it('cancels a long-running job via the cancel endpoint', async () => {
    const { app, store } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/job-proj/commands/long/runs',
    });
    const run = res.json() as { id: string };

    const cancel = await app.inject({ method: 'POST', url: `/api/v1/runs/${run.id}/cancel` });
    expect(cancel.statusCode).toBe(200);

    expect(await waitForTerminal(store, run.id)).toBe('CANCELLED');
  });

  it('returns 404 for an unknown command', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/job-proj/commands/nope/runs',
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a service command as a one-shot run', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/job-proj/commands/svc/runs',
    });
    expect(res.statusCode).toBe(422);
  });
});
