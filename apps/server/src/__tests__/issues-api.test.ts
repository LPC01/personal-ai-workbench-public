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
  const dir = mkdtempSync(join(tmpdir(), 'wb-issue-'));
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

describe('Issue API（§6.11 Issue→Resolution→Lesson）', () => {
  it('创建 → 证据 → resolve → verify → 晋升 Lesson 全链路', async () => {
    const app = setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      payload: { title: '数据交换空间配置问题', description: '跨组织数据共享配置失败' },
    });
    const issueId = (created.json() as { id: string }).id;
    expect((created.json() as { status: string }).status).toBe('OPEN');

    await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issueId}/evidence`,
      payload: { kind: 'run', uri: 'run:123' },
    });

    const resolved = await app.inject({ method: 'POST', url: `/api/v1/issues/${issueId}/resolve` });
    expect((resolved.json() as { status: string }).status).toBe('RESOLVED');

    const verified = await app.inject({ method: 'POST', url: `/api/v1/issues/${issueId}/verify` });
    expect((verified.json() as { status: string }).status).toBe('VERIFIED');

    const promoted = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issueId}/promote-to-lesson`,
    });
    expect(promoted.statusCode).toBe(200);

    const evidence = await app.inject({ method: 'GET', url: `/api/v1/issues/${issueId}/evidence` });
    expect((evidence.json() as { total: number }).total).toBe(1);
  });

  it('跳过 resolve 直接 verify 被状态机拒绝', async () => {
    const app = setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      payload: { title: 'x', description: 'y' },
    });
    const issueId = (created.json() as { id: string }).id;
    const res = await app.inject({ method: 'POST', url: `/api/v1/issues/${issueId}/verify` });
    expect(res.statusCode).toBe(409);
  });
});
