import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { InMemoryMemoryProvider } from '@workbench/memory-gateway';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

/**
 * 注入内存 Provider 以保证离线确定性（默认 OpenViking 受本机运行态影响）。
 * 生产链路装配见 `app.ts`；本测试只验证「记忆中心投影 + 状态机 + 隔离」语义。
 */
function setup(): { app: ReturnType<typeof buildApp> } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-memcenter-api-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return { app: buildApp(db, { memoryProvider: new InMemoryMemoryProvider() }) };
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

interface Candidate {
  uri: string;
  projectId: string | null;
  status: string;
  supersededBy: string | null;
  sourceUri: string | null;
}

async function propose(
  app: ReturnType<typeof buildApp>,
  body: Record<string, unknown>,
): Promise<{ status: number; uri?: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/memory/candidates',
    payload: body,
  });
  const json = res.json() as { ref?: { uri: string } };
  return { status: res.statusCode, uri: json.ref?.uri };
}

async function listCandidates(
  app: ReturnType<typeof buildApp>,
  query: string,
): Promise<Candidate[]> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/memory/candidates?${query}` });
  return (res.json() as { items: Candidate[] }).items;
}

describe('记忆中心 API（候选收件箱 / 资源 / 召回审计）', () => {
  it('候选全流程：CANDIDATE → VERIFIED → ACTIVE，并被 Candidate Inbox 列出', async () => {
    const { app } = setup();
    const created = await propose(app, {
      content: '经验：数据交换空间以 dataspace 为边界',
      projectId: 'proj-a',
      sourceUri: 'issue:iss-1',
    });
    expect(created.status).toBe(200);
    expect(created.uri).toBeTruthy();

    // 另一项目候选，用于验证项目隔离
    await propose(app, { content: 'B 项目经验', projectId: 'proj-b' });

    const inbox = await listCandidates(app, 'projectId=proj-a&status=CANDIDATE');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.sourceUri).toBe('issue:iss-1');

    const verify = await app.inject({
      method: 'POST',
      url: `/api/v1/memory/candidates/${created.uri}/verify`,
    });
    expect(verify.statusCode).toBe(200);
    expect((verify.json() as { status: string }).status).toBe('VERIFIED');

    expect(await listCandidates(app, 'projectId=proj-a&status=CANDIDATE')).toHaveLength(0);
    expect(await listCandidates(app, 'projectId=proj-a&status=VERIFIED')).toHaveLength(1);

    const activate = await app.inject({
      method: 'POST',
      url: `/api/v1/memory/candidates/${created.uri}/activate`,
    });
    expect(activate.statusCode).toBe(200);
    expect((activate.json() as { status: string }).status).toBe('ACTIVE');
  });

  it('跳过 verify 直接 activate 被状态机拒绝（409）', async () => {
    const { app } = setup();
    const { uri } = await propose(app, { content: '内容', projectId: 'proj-a' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/memory/candidates/${uri}/activate`,
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('RUN_STATE_CONFLICT');
  });

  it('supersede 记录取代关系并出现在 Superseded 列表', async () => {
    const { app } = setup();
    const oldOne = await propose(app, { content: '旧结论', projectId: 'proj-a' });
    const newOne = await propose(app, { content: '新结论', projectId: 'proj-a' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/memory/candidates/${oldOne.uri}/supersede`,
      payload: { supersededBy: newOne.uri },
    });
    expect(res.statusCode).toBe(200);

    const superseded = await listCandidates(app, 'projectId=proj-a&status=SUPERSEDED');
    expect(superseded).toHaveLength(1);
    expect(superseded[0]?.uri).toBe(oldOne.uri);
    expect(superseded[0]?.supersededBy).toBe(newOne.uri);
  });

  it('Secret/PII 候选被拒绝（422）且不落库', async () => {
    const { app } = setup();
    const secret = await propose(app, {
      content: 'api_key=sk-live-abcdefghijklmnop',
      projectId: 'proj-a',
    });
    expect(secret.status).toBe(422);

    const pii = await propose(app, { content: '联系 user@example.com', projectId: 'proj-a' });
    expect(pii.status).toBe(422);

    expect(await listCandidates(app, 'projectId=proj-a')).toHaveLength(0);
  });

  it('资源导入落投影：全量 Resources 列表按项目隔离', async () => {
    const { app } = setup();
    for (const [projectId, name, content] of [
      ['proj-a', 'intro', '内容 A'],
      ['proj-a', 'design', '内容 B'],
      ['proj-b', 'intro', '内容 C'],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/memory/import',
        payload: { projectId, name, content },
      });
      expect(res.statusCode).toBe(200);
    }

    const all = await app.inject({ method: 'GET', url: '/api/v1/memory/resources' });
    expect((all.json() as { total: number }).total).toBe(3);

    const a = await app.inject({
      method: 'GET',
      url: '/api/v1/memory/resources?projectId=proj-a',
    });
    const body = a.json() as { items: { uri: string }[]; total: number };
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.uri).sort()).toEqual([
      'project:proj-a:design',
      'project:proj-a:intro',
    ]);
  });

  it('召回写入审计：审计可列出、含预算与命中，且按项目隔离', async () => {
    const { app } = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/memory/import',
      payload: { projectId: 'proj-a', name: 'note', content: '数据交换空间的内部经验' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/memory/import',
      payload: { projectId: 'proj-b', name: 'note', content: '完全无关内容' },
    });

    const recall = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/recall',
      payload: { projectId: 'proj-a', query: '数据交换', budgetTokens: 1024 },
    });
    expect(recall.statusCode).toBe(200);
    const recallBody = recall.json() as {
      hits: { uri: string }[];
      record: { hitUris: string[]; budgetTokens: number };
    };
    expect(recallBody.hits.every((h) => h.uri.startsWith('project:proj-a:'))).toBe(true);
    expect(recallBody.record.budgetTokens).toBe(1024);

    const audit = await app.inject({
      method: 'GET',
      url: '/api/v1/memory/recall-audit?projectId=proj-a',
    });
    const auditBody = audit.json() as {
      items: { query: string; totalTokens: number; injectedPosition: string }[];
      total: number;
    };
    expect(auditBody.total).toBe(1);
    expect(auditBody.items[0]?.query).toBe('数据交换');
    expect(auditBody.items[0]?.totalTokens).toBeGreaterThan(0);
    expect(auditBody.items[0]?.injectedPosition).toBe('context');

    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/memory/recall-audit?projectId=proj-b',
    });
    expect((other.json() as { total: number }).total).toBe(0);
  });
});
