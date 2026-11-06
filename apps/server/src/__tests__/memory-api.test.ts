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
  const dir = mkdtempSync(join(tmpdir(), 'wb-mem-api-'));
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

describe('memory API（OpenViking 接入 + 降级）', () => {
  it('health 在 OpenViking 不可用时降级为 DEGRADED', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/memory/health' });
    const body = res.json() as { status: string };
    expect(body.status).toBe('DEGRADED');
  });

  it('import + search 在降级实现下可工作', async () => {
    const { app } = setup();
    const imp = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/import',
      payload: {
        projectId: 'demo-project',
        name: 'lesson-consistency',
        content: '采购与库存主数据需建立映射保证一致率',
      },
    });
    expect(imp.statusCode).toBe(200);
    expect((imp.json() as { uri: string }).uri).toBe('project:demo-project:lesson-consistency');

    const search = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/search',
      payload: { projectId: 'demo-project', query: '一致率' },
    });
    const body = search.json() as { total: number };
    expect(body.total).toBeGreaterThan(0);
  });

  it('跨项目检索隔离（仅当前项目命中）', async () => {
    const { app } = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/memory/import',
      payload: { projectId: 'demo-project', name: 'x', content: '示例指标一致率' },
    });
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/search',
      payload: { projectId: 'other-project', query: '示例指标一致率' },
    });
    expect((other.json() as { total: number }).total).toBe(0);
  });
});
