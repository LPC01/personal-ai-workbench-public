import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openConnection } from '../connection.js';
import { runMigrations } from '../migration-runner.js';
import { migrations } from '../migrations/index.js';
import { RunStore } from '../run-store.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function newStore(): { db: Database.Database; store: RunStore } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-run-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return { db, store: new RunStore(db) };
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

describe('RunStore', () => {
  it('creates a run with CREATED status', () => {
    const { store } = newStore();
    const run = store.createRun({ kind: 'job', input: { a: 1 } });
    expect(run.status).toBe('CREATED');
    expect(run.kind).toBe('job');
    expect(run.input).toEqual({ a: 1 });
    expect(run.startedAt).toBeNull();
    expect(run.finishedAt).toBeNull();
  });

  it('walks the full success path and sets timestamps', () => {
    const { store } = newStore();
    const run = store.createRun({ kind: 'workflow' });
    const path = ['VALIDATING', 'QUEUED', 'STARTING', 'RUNNING', 'SUCCEEDED'] as const;
    let current = run;
    for (const status of path) {
      current = store.transitionRun(run.id, status);
      expect(current.status).toBe(status);
    }
    expect(current.startedAt).not.toBeNull();
    expect(current.finishedAt).not.toBeNull();
  });

  it('throws RUN_STATE_CONFLICT on illegal transition', () => {
    const { store } = newStore();
    const run = store.createRun({ kind: 'job' });
    expect(() => store.transitionRun(run.id, 'RUNNING')).toThrowError(
      expect.objectContaining({ code: 'RUN_STATE_CONFLICT' }),
    );
  });

  it('forbids transition from terminal state', () => {
    const { store } = newStore();
    const run = store.createRun({ kind: 'job' });
    store.transitionRun(run.id, 'VALIDATING');
    store.transitionRun(run.id, 'FAILED');
    expect(() => store.transitionRun(run.id, 'RUNNING')).toThrowError(
      expect.objectContaining({ code: 'RUN_STATE_CONFLICT' }),
    );
  });

  it('appends events with monotonic sequence', () => {
    const { store } = newStore();
    const run = store.createRun({ kind: 'agent' });
    const e1 = store.appendRunEvent(run.id, 'state', { from: 'CREATED' });
    const e2 = store.appendRunEvent(run.id, 'state', { from: 'VALIDATING' });
    const e3 = store.appendRunEvent(run.id, 'log', { msg: 'done' });
    expect([e1.sequence, e2.sequence, e3.sequence]).toEqual([1, 2, 3]);

    const events = store.listRunEvents(run.id);
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(events[0]?.eventType).toBe('state');
    expect(events[2]?.payload).toEqual({ msg: 'done' });
  });

  it('lists runs', () => {
    const { store } = newStore();
    store.createRun({ kind: 'job' });
    store.createRun({ kind: 'builder' });
    expect(store.listRuns()).toHaveLength(2);
  });

  it('listRunEventsAfter returns only newer events (reconnection replay)', () => {
    const { store } = newStore();
    const run = store.createRun({ kind: 'job' });
    store.appendRunEvent(run.id, 'state', { from: 'CREATED' });
    store.appendRunEvent(run.id, 'state', { from: 'VALIDATING' });
    store.appendRunEvent(run.id, 'log', { msg: 'hi' });

    const after = store.listRunEventsAfter(run.id, 1);
    expect(after.map((e) => e.sequence)).toEqual([2, 3]);

    expect(store.listRunEventsAfter(run.id, 3)).toEqual([]);
  });

  it('cancelRun: QUEUED 直接 CANCELLED', () => {
    const { store } = newStore();
    const run = store.createRun({ kind: 'job' });
    store.transitionRun(run.id, 'VALIDATING');
    store.transitionRun(run.id, 'QUEUED');
    const cancelled = store.cancelRun(run.id);
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('cancelRun: RUNNING 进入 CANCELLING', () => {
    const { store } = newStore();
    const run = store.createRun({ kind: 'job' });
    store.transitionRun(run.id, 'VALIDATING');
    store.transitionRun(run.id, 'QUEUED');
    store.transitionRun(run.id, 'STARTING');
    store.transitionRun(run.id, 'RUNNING');
    expect(store.cancelRun(run.id).status).toBe('CANCELLING');
  });

  it('cancelRun: 终态不可取消', () => {
    const { store } = newStore();
    const run = store.createRun({ kind: 'job' });
    store.transitionRun(run.id, 'VALIDATING');
    store.transitionRun(run.id, 'FAILED');
    expect(() => store.cancelRun(run.id)).toThrowError(
      expect.objectContaining({ code: 'RUN_NOT_CANCELABLE' }),
    );
  });

  it('timeoutRun: RUNNING 超时标记 FAILED（error_code=TIMEOUT）', () => {
    const { store } = newStore();
    const run = store.createRun({ kind: 'job' });
    store.transitionRun(run.id, 'VALIDATING');
    store.transitionRun(run.id, 'QUEUED');
    store.transitionRun(run.id, 'STARTING');
    store.transitionRun(run.id, 'RUNNING');
    const failed = store.timeoutRun(run.id);
    expect(failed.status).toBe('FAILED');
    expect(failed.errorCode).toBe('TIMEOUT');
  });

  it('markUnknown + reconcileRun: UNKNOWN→RECONCILING→SUCCEEDED', () => {
    const { store } = newStore();
    const run = store.createRun({ kind: 'job' });
    store.transitionRun(run.id, 'VALIDATING');
    store.transitionRun(run.id, 'QUEUED');
    store.transitionRun(run.id, 'STARTING');
    store.transitionRun(run.id, 'RUNNING');
    expect(store.markUnknown(run.id).status).toBe('UNKNOWN');

    const reconciled = store.reconcileRun(run.id, 'SUCCEEDED');
    expect(reconciled.status).toBe('SUCCEEDED');
  });

  it('reconcileOnStartup converges non-terminal runs to terminal states', () => {
    const { store } = newStore();

    const toRunning = (id: string) => {
      store.transitionRun(id, 'VALIDATING');
      store.transitionRun(id, 'QUEUED');
      store.transitionRun(id, 'STARTING');
      store.transitionRun(id, 'RUNNING');
    };

    const running = store.createRun({ kind: 'job' });
    toRunning(running.id);

    const queued = store.createRun({ kind: 'job' });
    store.transitionRun(queued.id, 'VALIDATING');
    store.transitionRun(queued.id, 'QUEUED');

    const unknown = store.createRun({ kind: 'job' });
    toRunning(unknown.id);
    store.markUnknown(unknown.id);

    const waiting = store.createRun({ kind: 'job' });
    toRunning(waiting.id);
    store.transitionRun(waiting.id, 'WAITING_USER');

    const created = store.createRun({ kind: 'job' });

    const succeeded = store.createRun({ kind: 'job' });
    toRunning(succeeded.id);
    store.transitionRun(succeeded.id, 'SUCCEEDED');

    const results = store.reconcileOnStartup();

    const byId = new Map(results.map((r) => [r.runId, r.to]));
    expect(byId.get(running.id)).toBe('FAILED');
    expect(byId.get(queued.id)).toBe('CANCELLED');
    expect(byId.get(unknown.id)).toBe('FAILED');
    expect(byId.get(waiting.id)).toBe('FAILED');
    expect(byId.get(created.id)).toBe('FAILED');
    expect(byId.has(succeeded.id)).toBe(false); // 终态不动

    expect(store.getRun(running.id)?.errorCode).toBe('HOST_RESTARTED');
    expect(store.getRun(succeeded.id)?.status).toBe('SUCCEEDED');
  });
});
