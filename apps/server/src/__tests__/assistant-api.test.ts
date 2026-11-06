import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): ReturnType<typeof buildApp> {
  const dir = mkdtempSync(join(tmpdir(), 'wb-asstapi-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return buildApp(db);
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

describe('Assistant 草稿 API', () => {
  it('创建并读取 Assistant 草稿', async () => {
    const app = setup();
    // 先建立父级链：会话 → generate-spec → 扩展草稿 id
    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/studio/sessions',
      payload: { title: '会议纪要助手' },
    });
    const sessionId = (session.json() as { id: string }).id;
    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/studio/sessions/${sessionId}/generate-spec`,
    });
    const draftId = (generated.json() as { id: string }).id;

    const payload = {
      systemPrompt: '你是会议纪要助手',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      outputSchema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
      toolWhitelist: ['artifact.publish'],
      modelRequirements: { structuredOutput: true },
    };
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/extension-drafts/${draftId}/assistant`,
      payload,
    });
    expect(created.statusCode).toBe(200);
    expect((created.json() as { systemPrompt: string }).systemPrompt).toBe('你是会议纪要助手');

    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/extension-drafts/${draftId}/assistant`,
    });
    expect(got.statusCode).toBe(200);
    expect((got.json() as { toolWhitelist: string[] }).toolWhitelist).toEqual(['artifact.publish']);
  });

  it('未创建时 GET 返回 null', async () => {
    const app = setup();
    const got = await app.inject({ method: 'GET', url: '/api/v1/extension-drafts/nope/assistant' });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toBeNull();
  });
});
