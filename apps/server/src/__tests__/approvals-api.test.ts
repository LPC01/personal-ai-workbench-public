import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { ApprovalStore, migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { app: ReturnType<typeof buildApp>; approvals: ApprovalStore } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-apr-api-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return { app: buildApp(db), approvals: new ApprovalStore(db) };
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

describe('approvals API', () => {
  it('lists approvals and decides them', async () => {
    const { app, approvals } = setup();
    const approval = approvals.create({
      actionType: 'local-to-cloud',
      targetRef: 'profile:cloud',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const list = await app.inject({ method: 'GET', url: '/api/v1/approvals' });
    expect((list.json() as { total: number }).total).toBe(1);

    const decide = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approval.id}/decide`,
      payload: { approved: true },
    });
    expect((decide.json() as { status: string }).status).toBe('APPROVED');
  });

  it('creates an approval via POST /approvals', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals',
      payload: { actionType: 'local-to-cloud', targetRef: 'profile:cloud' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('PENDING');
  });

  it('rejects POST /approvals without actionType/targetRef', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/approvals',
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });
});
