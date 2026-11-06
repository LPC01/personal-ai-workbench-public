import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openConnection } from '../connection.js';
import { runMigrations } from '../migration-runner.js';
import { migrations } from '../migrations/index.js';
import { ApprovalStore } from '../approval-store.js';
import { AuditStore } from '../audit-store.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function newDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'wb-audit-'));
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

describe('AuditStore', () => {
  it('records and lists audit events', () => {
    const db = newDb();
    const store = new AuditStore(db);
    store.record('user', 'project.register', 'demo-project', { by: 'api' });
    store.record('system', 'run.transition', 'run_1', { from: 'RUNNING', to: 'SUCCEEDED' });

    const events = store.list();
    expect(events).toHaveLength(2);
    expect(events[0]?.action).toBe('run.transition'); // 倒序，最新在前
    expect(events[0]?.details).toEqual({ from: 'RUNNING', to: 'SUCCEEDED' });
    expect(events[1]?.targetRef).toBe('demo-project');
  });
});

describe('ApprovalStore', () => {
  it('creates a PENDING approval and approves it', () => {
    const db = newDb();
    const store = new ApprovalStore(db);
    const future = new Date(Date.now() + 60_000).toISOString();
    const approval = store.create({
      actionType: 'local-to-cloud',
      targetRef: 'profile:cloud-reasoning',
      expiresAt: future,
    });
    expect(approval.status).toBe('PENDING');
    expect(approval.decidedAt).toBeNull();

    const decided = store.decide(approval.id, true);
    expect(decided.status).toBe('APPROVED');
    expect(decided.decidedAt).not.toBeNull();
  });

  it('rejects an approval', () => {
    const db = newDb();
    const store = new ApprovalStore(db);
    const approval = store.create({
      actionType: 'extension-install',
      targetRef: 'ext:foo',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(store.decide(approval.id, false).status).toBe('REJECTED');
  });

  it('throws when deciding an already-decided approval', () => {
    const db = newDb();
    const store = new ApprovalStore(db);
    const approval = store.create({
      actionType: 'x',
      targetRef: 'y',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    store.decide(approval.id, true);
    expect(() => store.decide(approval.id, false)).toThrow(/已裁决/);
  });

  it('throws when deciding an expired approval', () => {
    const db = newDb();
    const store = new ApprovalStore(db);
    const approval = store.create({
      actionType: 'x',
      targetRef: 'y',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(() => store.decide(approval.id, true)).toThrow(/过期/);
  });
});
