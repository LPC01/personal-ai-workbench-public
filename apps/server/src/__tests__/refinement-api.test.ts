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
  const dir = mkdtempSync(join(tmpdir(), 'wb-refine-'));
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

async function seedRun(app: ReturnType<typeof buildApp>): Promise<string> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    payload: { name: 'R', roomType: 'sdd-delivery', manifest: { id: 'room_x' } },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/rooms/room_x/runs',
    payload: { protocolId: 'sequential', protocolVersion: '1.0' },
  });
  return (res.json() as { id: string }).id;
}

describe('记忆提炼 API（MA-08）', () => {
  it('refineToCandidate 脱敏 + 来源验证 + MEMORY_CANDIDATE_CREATED 事件', async () => {
    const { app } = setup();
    const runId = await seedRun(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/memory-candidates`,
      payload: {
        content: '结论：用 sk_abcdefghijklmnopqrstuvwxyz123456 认证',
        source: { roomRunId: runId, artifactId: 'a1' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { cleaned: string; redacted: string[] };
    expect(body.cleaned).not.toContain('sk_abcdefghijklmnopqrstuvwxyz123456');
    expect(body.redacted.length).toBeGreaterThan(0);

    const events = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${runId}/events` });
    expect(
      (events.json() as { items: { eventType: string }[] }).items.some(
        (e) => e.eventType === 'MEMORY_CANDIDATE_CREATED',
      ),
    ).toBe(true);
  });

  it('缺具体来源 → 422 EVIDENCE_REQUIRED', async () => {
    const { app } = setup();
    const runId = await seedRun(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/memory-candidates`,
      payload: { content: '内容', source: { roomRunId: runId } },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe('EVIDENCE_REQUIRED');
  });
});
