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
  const dir = mkdtempSync(join(tmpdir(), 'wb-studio-'));
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

describe('Studio API（§10.3）', () => {
  it('创建会话 → 发需求 → generate-spec 生成草稿', async () => {
    const app = setup();
    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/studio/sessions',
      payload: { title: '会议纪要助手' },
    });
    expect(session.statusCode).toBe(200);
    const sessionId = (session.json() as { id: string }).id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/studio/sessions/${sessionId}/messages`,
      payload: { role: 'user', content: '帮我整理会议纪要' },
    });

    const draft = await app.inject({
      method: 'POST',
      url: `/api/v1/studio/sessions/${sessionId}/generate-spec`,
    });
    expect(draft.statusCode).toBe(200);
    const body = draft.json() as { spec: { extension: { id: string; types: string[] } } };
    expect(body.spec.extension.types).toContain('assistant');
    expect(body.spec.extension.id.length).toBeGreaterThanOrEqual(3);
  });

  it('含「工作流」需求 → 生成 workflow 类型', async () => {
    const app = setup();
    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/studio/sessions',
      payload: { title: '数据处理工作流' },
    });
    const sessionId = (session.json() as { id: string }).id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/studio/sessions/${sessionId}/messages`,
      payload: { role: 'user', content: '做一个数据处理工作流' },
    });
    const draft = await app.inject({
      method: 'POST',
      url: `/api/v1/studio/sessions/${sessionId}/generate-spec`,
    });
    const body = draft.json() as { spec: { extension: { types: string[] } } };
    expect(body.spec.extension.types).toContain('workflow');
  });

  it('generate-spec 对不存在的会话返回 404', async () => {
    const app = setup();
    const draft = await app.inject({
      method: 'POST',
      url: '/api/v1/studio/sessions/nope/generate-spec',
    });
    expect(draft.statusCode).toBe(404);
  });
});
