import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

interface Ctx {
  app: ReturnType<typeof buildApp>;
  draftId: string;
}

async function setup(): Promise<Ctx> {
  const dir = mkdtempSync(join(tmpdir(), 'wb-dvc-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const app = buildApp(db);

  const session = await app.inject({
    method: 'POST',
    url: '/api/v1/studio/sessions',
    payload: { title: '会议纪要助手' },
  });
  const sessionId = (session.json() as { id: string }).id;
  await app.inject({
    method: 'POST',
    url: `/api/v1/studio/sessions/${sessionId}/messages`,
    payload: { role: 'user', content: '帮我整理会议纪要' },
  });
  const generated = await app.inject({
    method: 'POST',
    url: `/api/v1/studio/sessions/${sessionId}/generate-spec`,
  });
  const draftId = (generated.json() as { id: string }).id;

  // 建立 Assistant 草稿
  await app.inject({
    method: 'POST',
    url: `/api/v1/extension-drafts/${draftId}/assistant`,
    payload: {
      systemPrompt: '你是会议纪要助手',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      outputSchema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
      toolWhitelist: ['artifact.publish'],
      modelRequirements: { structuredOutput: true },
    },
  });

  return { app, draftId };
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

describe('草稿验证 API（§10.3 build/test/eval）', () => {
  it('build 校验 Spec 通过', async () => {
    const { app, draftId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/extension-drafts/${draftId}/build`,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('passed');
  });

  it('test 校验输入输出 Schema 通过', async () => {
    const { app, draftId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/extension-drafts/${draftId}/test`,
    });
    const body = res.json() as { status: string; report: { inputSchemaValid: boolean } };
    expect(body.status).toBe('passed');
    expect(body.report.inputSchemaValid).toBe(true);
  });

  it('eval 检查结构化输出 + 工具白名单 + 提示', async () => {
    const { app, draftId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/extension-drafts/${draftId}/eval`,
    });
    const body = res.json() as { status: string; report: { caseCount: number; passed: number } };
    expect(body.status).toBe('passed');
    expect(body.report.passed).toBe(body.report.caseCount);
  });

  it('preview 汇总 spec + assistant + 验证结果', async () => {
    const { app, draftId } = await setup();
    await app.inject({ method: 'POST', url: `/api/v1/extension-drafts/${draftId}/build` });
    await app.inject({ method: 'POST', url: `/api/v1/extension-drafts/${draftId}/eval` });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/extension-drafts/${draftId}/preview`,
    });
    const body = res.json() as { specName: string; toolWhitelist: string[]; checks: unknown[] };
    expect(body.specName).toBe('会议纪要助手');
    expect(body.toolWhitelist).toEqual(['artifact.publish']);
    expect(body.checks.length).toBe(2);
  });

  it('对不存在草稿 build 返回 404', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/v1/extension-drafts/nope/build' });
    expect(res.statusCode).toBe(404);
  });

  it('permissions-review 返回数据流与风险', async () => {
    const { app, draftId } = await setup();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/extension-drafts/${draftId}/permissions-review`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      dataFlow: { inputs: string[]; outputs: string[] };
      risks: { level: string }[];
    };
    expect(body.dataFlow.inputs).toEqual(['inputs/**']);
    expect(body.dataFlow.outputs).toEqual(['artifacts/**']);
    expect(body.risks.length).toBeGreaterThan(0);
  });
});
