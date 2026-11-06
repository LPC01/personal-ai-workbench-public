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
  const dir = mkdtempSync(join(tmpdir(), 'wb-apapi-'));
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

describe('AgentProfile API（MA-03）', () => {
  it('upsert 版本化 + 幂等，get 支持 revision', async () => {
    const { app } = setup();
    const def = { systemInstruction: '你是设计 Agent' };
    const p1 = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-profiles',
      payload: { id: 'designer', definition: def },
    });
    expect((p1.json() as { revision: number }).revision).toBe(1);

    const p1b = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-profiles',
      payload: { id: 'designer', definition: def },
    });
    expect((p1b.json() as { revision: number }).revision).toBe(1); // 幂等

    const p2 = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-profiles',
      payload: { id: 'designer', definition: { systemInstruction: '改' } },
    });
    expect((p2.json() as { revision: number }).revision).toBe(2);

    const got = await app.inject({
      method: 'GET',
      url: '/api/v1/agent-profiles/designer?revision=1',
    });
    expect(
      (got.json() as { definition: { systemInstruction: string } }).definition.systemInstruction,
    ).toBe('你是设计 Agent');
  });

  it('创建 AgentSession 固定快照 + 工具权限交集', async () => {
    const { app } = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/agent-profiles',
      payload: { id: 'designer', definition: { systemInstruction: '你是设计 Agent' } },
    });
    // 前置：room + run（FK 约束）
    await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: { name: 'R', roomType: 'sdd-delivery', manifest: { id: 'room_x' } },
    });
    const run = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms/room_x/runs',
      payload: { protocolId: 'sequential', protocolVersion: '1.0' },
    });
    const runId = (run.json() as { id: string }).id;

    const s = await app.inject({
      method: 'POST',
      url: '/api/v1/agent-sessions',
      payload: {
        roomRunId: runId,
        participantId: 'designer',
        agentProfileId: 'designer',
        modelBinding: { modelProfileId: 'kimi', revision: 1 },
        toolPolicies: [
          { allowedTools: ['project.describe', 'artifact.read'] },
          { allowedTools: ['project.describe', 'artifact.publish'] },
        ],
      },
    });
    expect(s.statusCode).toBe(200);
    const session = s.json() as {
      id: string;
      modelBinding: { modelProfileId: string };
      toolPolicy: { allowedTools: string[] };
    };
    expect(session.modelBinding.modelProfileId).toBe('kimi');
    expect(session.toolPolicy.allowedTools).toEqual(['project.describe']); // 交集

    const list = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${runId}/sessions` });
    expect((list.json() as { total: number }).total).toBe(1);
  });

  it('get 不存在的 profile 返回 404', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/agent-profiles/nope' });
    expect(res.statusCode).toBe(404);
  });
});
