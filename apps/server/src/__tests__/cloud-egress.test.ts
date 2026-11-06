import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { ApprovalStore, migrations, openConnection, runMigrations } from '@workbench/persistence';
import { CloudEgressGate } from '../cloud-egress.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { gate: CloudEgressGate; approvals: ApprovalStore } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-egress-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const approvals = new ApprovalStore(db);
  return { gate: new CloudEgressGate(approvals), approvals };
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

describe('CloudEgressGate', () => {
  it('requires no approval for local-only', () => {
    const { gate } = setup();
    expect(gate.requestIfCloud('local-only', 'profile:x')).toBeUndefined();
  });

  it('creates a PENDING approval for cloud', () => {
    const { gate } = setup();
    const approval = gate.requestIfCloud('cloud', 'profile:cloud-reasoning', { note: 'send data' });
    expect(approval?.status).toBe('PENDING');
    expect(approval?.actionType).toBe('local-to-cloud');
  });

  it('throws APPROVAL_REQUIRED until approved, then passes', () => {
    const { gate, approvals } = setup();
    const approval = gate.requestIfCloud('cloud', 'profile:cloud-reasoning');
    expect(() => gate.assertApproved('profile:cloud-reasoning')).toThrowError(
      expect.objectContaining({ code: 'APPROVAL_REQUIRED' }),
    );

    approvals.decide(approval?.id as string, true);

    expect(gate.assertApproved('profile:cloud-reasoning').status).toBe('APPROVED');
  });
});
