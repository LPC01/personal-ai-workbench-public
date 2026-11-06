import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { ProjectCommand, ProjectManifest } from '@workbench/contracts';
import {
  migrations,
  openConnection,
  runMigrations,
  RunStore,
  type RunRecord,
} from '@workbench/persistence';
import { ProjectCatalog, RunStreamHub } from '@workbench/project-runtime';
import { JobRunner } from '../job-runner.js';

const NODE = process.execPath;
const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/integration/fixtures/sample-job',
);

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { db: Database.Database; store: RunStore; hub: RunStreamHub; runner: JobRunner } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-job-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  new ProjectCatalog(db).register(manifest());
  const store = new RunStore(db);
  const hub = new RunStreamHub();
  return { db, store, hub, runner: new JobRunner(store, hub) };
}

function manifest(): ProjectManifest {
  return {
    schemaVersion: 'workbench.project/v1',
    project: { id: 'job-proj', name: 'Job 项目' },
    runtime: { root: FIXTURE },
  };
}

function jobCmd(id: string, script: string): ProjectCommand {
  return { id, type: 'job', executable: NODE, arguments: [script] };
}

async function waitForTerminal(
  store: RunStore,
  runId: string,
  timeoutMs = 8000,
): Promise<RunRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = store.getRun(runId) as RunRecord;
    if (run.status === 'SUCCEEDED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
      return run;
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

describe('JobRunner', () => {
  it('runs a successful job to SUCCEEDED with events', async () => {
    const { store, runner } = setup();
    const run = await runner.start({
      projectId: 'job-proj',
      command: jobCmd('ok', 'success.js'),
      manifest: manifest(),
    });
    expect(run.status).toBe('RUNNING');

    const final = await waitForTerminal(store, run.id);
    expect(final.status).toBe('SUCCEEDED');
    expect(final.exitCode).toBe(0);

    const events = store.listRunEvents(run.id);
    expect(events.some((e) => e.eventType === 'state' && e.payload.to === 'SUCCEEDED')).toBe(true);
    expect(
      events.some((e) => e.eventType === 'log' && String(e.payload.data).includes('job-success')),
    ).toBe(true);
  });

  it('runs a failing job to FAILED with exit code', async () => {
    const { store, runner } = setup();
    const run = await runner.start({
      projectId: 'job-proj',
      command: jobCmd('fail', 'fail.js'),
      manifest: manifest(),
    });

    const final = await waitForTerminal(store, run.id);
    expect(final.status).toBe('FAILED');
    expect(final.exitCode).toBe(2);
    expect(final.errorCode).toBe('NON_ZERO_EXIT');
  });

  it('cancels a long-running job to CANCELLED', async () => {
    const { store, runner } = setup();
    const run = await runner.start({
      projectId: 'job-proj',
      command: jobCmd('long', 'long.js'),
      manifest: manifest(),
    });
    expect(run.status).toBe('RUNNING');

    const cancelled = runner.cancel(run.id);
    expect(cancelled.status).toBe('CANCELLING');

    const final = await waitForTerminal(store, run.id);
    expect(final.status).toBe('CANCELLED');
  });

  it('fails validation when command arguments are invalid', async () => {
    const { store, runner } = setup();
    const bad: ProjectCommand = {
      id: 'bad',
      type: 'job',
      executable: NODE,
      arguments: ['bad*.js'],
    };
    const run = await runner.start({ projectId: 'job-proj', command: bad, manifest: manifest() });

    expect(run.status).toBe('FAILED');
    expect(run.errorCode).toBe('COMMAND_ARGUMENT_INVALID');
    expect(store.getRun(run.id)?.status).toBe('FAILED');
  });

  it('fails a job whose executable is not on the allowlist', async () => {
    const { store, runner } = setup();
    // 显式给空参数数组：`validateCommandArguments(undefined)` 会先抛 COMMAND_ARGUMENT_INVALID
    // （已登记为任务外 Issue），这里要触达的是可执行白名单这一关。
    const evil: ProjectCommand = {
      id: 'evil',
      type: 'job',
      executable: 'calc.exe',
      arguments: [],
    };
    const run = await runner.start({ projectId: 'job-proj', command: evil, manifest: manifest() });

    expect(run.status).toBe('FAILED');
    expect(run.errorCode).toBe('COMMAND_NOT_REGISTERED');
    expect(store.getRun(run.id)?.status).toBe('FAILED');
  });

  it('fails a job whose cwd escapes the controlled root', async () => {
    const { store, runner } = setup();
    const escape: ProjectCommand = {
      id: 'escape',
      type: 'job',
      executable: NODE,
      arguments: ['success.js'],
      cwd: join('..', '..'),
    };
    const run = await runner.start({
      projectId: 'job-proj',
      command: escape,
      manifest: manifest(),
    });

    expect(run.status).toBe('FAILED');
    expect(run.errorCode).toBe('PATH_OUTSIDE_ROOT');
    expect(store.getRun(run.id)?.status).toBe('FAILED');
  });

  it('fails a job exceeding timeoutSeconds with TIMEOUT', async () => {
    const { store, runner } = setup();
    const slow: ProjectCommand = {
      id: 'slow',
      type: 'job',
      executable: NODE,
      arguments: ['long.js'],
      timeoutSeconds: 1,
    };
    const run = await runner.start({
      projectId: 'job-proj',
      command: slow,
      manifest: manifest(),
    });
    expect(run.status).toBe('RUNNING');

    const final = await waitForTerminal(store, run.id);
    expect(final.status).toBe('FAILED');
    expect(final.errorCode).toBe('TIMEOUT');

    const events = store.listRunEvents(run.id);
    expect(
      events.some(
        (e) =>
          e.eventType === 'state' && e.payload.to === 'FAILED' && e.payload.errorCode === 'TIMEOUT',
      ),
    ).toBe(true);
  });

  it('does not terminate a job when timeoutSeconds is 0 (no limit)', async () => {
    const { store, runner } = setup();
    const unlimited: ProjectCommand = {
      id: 'unlimited',
      type: 'job',
      executable: NODE,
      arguments: ['long.js'],
      timeoutSeconds: 0,
    };
    const run = await runner.start({
      projectId: 'job-proj',
      command: unlimited,
      manifest: manifest(),
    });

    // 静置超过 1 秒：若误把 0 当作超时，这里会已转 FAILED。
    await new Promise((r) => setTimeout(r, 1200));
    expect(store.getRun(run.id)?.status).toBe('RUNNING');

    // 收尾：手动取消，避免遗留常驻子进程。
    runner.cancel(run.id);
    const final = await waitForTerminal(store, run.id);
    expect(final.status).toBe('CANCELLED');
  });

  it('rejects a second concurrent run when the command is singleton', async () => {
    const { store, runner } = setup();
    const singleton: ProjectCommand = {
      id: 'singleton',
      type: 'job',
      executable: NODE,
      arguments: ['long.js'],
      concurrency: 'singleton',
    };
    const first = await runner.start({
      projectId: 'job-proj',
      command: singleton,
      manifest: manifest(),
    });
    expect(first.status).toBe('RUNNING');

    const second = await runner.start({
      projectId: 'job-proj',
      command: singleton,
      manifest: manifest(),
    });
    expect(second.status).toBe('FAILED');
    expect(second.errorCode).toBe('RUN_STATE_CONFLICT');
    expect(store.getRun(second.id)?.status).toBe('FAILED');

    const events = store.listRunEvents(second.id);
    expect(
      events.some(
        (e) =>
          e.eventType === 'state' &&
          e.payload.errorCode === 'RUN_STATE_CONFLICT' &&
          e.payload.activeRunId === first.id,
      ),
    ).toBe(true);

    // 首个 Run 不受影响，收尾取消。
    expect(store.getRun(first.id)?.status).toBe('RUNNING');
    runner.cancel(first.id);
    expect((await waitForTerminal(store, first.id)).status).toBe('CANCELLED');
  });

  it('allows a second concurrent run when the command is parallel', async () => {
    const { store, runner } = setup();
    const parallel: ProjectCommand = {
      id: 'parallel',
      type: 'job',
      executable: NODE,
      arguments: ['long.js'],
      concurrency: 'parallel',
    };
    const first = await runner.start({
      projectId: 'job-proj',
      command: parallel,
      manifest: manifest(),
    });
    const second = await runner.start({
      projectId: 'job-proj',
      command: parallel,
      manifest: manifest(),
    });
    expect(first.status).toBe('RUNNING');
    expect(second.status).toBe('RUNNING');

    runner.cancel(first.id);
    runner.cancel(second.id);
    await waitForTerminal(store, first.id);
    await waitForTerminal(store, second.id);
  });

  it('allows a second run after the first reaches terminal (singleton is not a permanent lock)', async () => {
    const { store, runner } = setup();
    const singleton: ProjectCommand = {
      id: 'singleton-seq',
      type: 'job',
      executable: NODE,
      arguments: ['success.js'],
      concurrency: 'singleton',
    };
    const first = await runner.start({
      projectId: 'job-proj',
      command: singleton,
      manifest: manifest(),
    });
    expect((await waitForTerminal(store, first.id)).status).toBe('SUCCEEDED');

    const second = await runner.start({
      projectId: 'job-proj',
      command: singleton,
      manifest: manifest(),
    });
    expect(second.status).toBe('RUNNING');
    expect((await waitForTerminal(store, second.id)).status).toBe('SUCCEEDED');
  });
});
