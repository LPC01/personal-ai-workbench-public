import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { app: ReturnType<typeof buildApp> } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-sdd-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return { app: buildApp(db) };
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

async function createSddRun(app: ReturnType<typeof buildApp>): Promise<string> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    payload: { name: 'SDD 交付室', roomType: 'sdd-delivery', manifest: { id: 'room_sdd' } },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/rooms/room_sdd/sdd-runs',
    payload: {},
  });
  return (res.json() as { id: string }).id;
}

async function advance(
  app: ReturnType<typeof buildApp>,
  runId: string,
  ctx: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/room-runs/${runId}/sdd-advance`,
    payload: ctx,
  });
}

const GATE_CTX = { specApproved: true, hasFinalArtifact: true };

describe('SDD 交付协议 API（MA-07）', () => {
  it('创建 SDD Run 初始阶段 INTAKE', async () => {
    const { app } = setup();
    const runId = await createSddRun(app);
    const stage = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${runId}/sdd-stage` });
    expect((stage.json() as { stage: string }).stage).toBe('INTAKE');
  });

  it('推进阶段 + SDD_STAGE_ADVANCED 事件', async () => {
    const { app } = setup();
    const runId = await createSddRun(app);
    const res = await advance(app, runId, GATE_CTX);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { stage: string }).stage).toBe('SPEC_DRAFT');

    const events = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${runId}/events` });
    expect(
      (events.json() as { items: { eventType: string }[] }).items.some(
        (e) => e.eventType === 'SDD_STAGE_ADVANCED',
      ),
    ).toBe(true);
  });

  it('未批准 Spec 不得进入 IMPLEMENTATION → 409', async () => {
    const { app } = setup();
    const runId = await createSddRun(app);
    // INTAKE → SPEC_DRAFT → SPEC_REVIEW → WAITING_SPEC_APPROVAL
    for (const ctx of [
      GATE_CTX,
      GATE_CTX,
      GATE_CTX,
      { specApproved: false, hasFinalArtifact: true },
    ]) {
      await advance(app, runId, ctx);
    }
    const res = await advance(app, runId, { specApproved: false, hasFinalArtifact: true });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ROOM_RUN_STATE_CONFLICT');
  });

  it('批准 Spec 后进入 IMPLEMENTATION', async () => {
    const { app } = setup();
    const runId = await createSddRun(app);
    // 推进到 WAITING_SPEC_APPROVAL
    await advance(app, runId, GATE_CTX); // SPEC_DRAFT
    await advance(app, runId, GATE_CTX); // SPEC_REVIEW
    await advance(app, runId, GATE_CTX); // WAITING_SPEC_APPROVAL
    const res = await advance(app, runId, GATE_CTX); // specApproved=true → IMPLEMENTATION
    expect((res.json() as { stage: string }).stage).toBe('IMPLEMENTATION');
  });

  it('INDEPENDENT_REVIEW REWORK → 409 返工', async () => {
    const { app } = setup();
    const runId = await createSddRun(app);
    // 推进到 INDEPENDENT_REVIEW（经过 6 次推进）
    await advance(app, runId, GATE_CTX); // SPEC_DRAFT
    await advance(app, runId, GATE_CTX); // SPEC_REVIEW
    await advance(app, runId, GATE_CTX); // WAITING_SPEC_APPROVAL
    await advance(app, runId, GATE_CTX); // IMPLEMENTATION
    await advance(app, runId, GATE_CTX); // VERIFICATION
    await advance(app, runId, GATE_CTX); // INDEPENDENT_REVIEW
    const res = await advance(app, runId, { ...GATE_CTX, reviewDecision: 'REWORK' });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ROOM_RUN_STATE_CONFLICT');
  });

  it('最终 Decision 缺 Artifact → 409', async () => {
    const { app } = setup();
    const runId = await createSddRun(app);
    for (let i = 0; i < 7; i++) {
      await advance(app, runId, GATE_CTX); // 推进到 DECISION
    }
    const res = await advance(app, runId, { ...GATE_CTX, hasFinalArtifact: false });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ROOM_RUN_STATE_CONFLICT');
  });
});
