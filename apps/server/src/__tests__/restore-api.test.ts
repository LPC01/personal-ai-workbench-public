import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { app: ReturnType<typeof buildApp>; db: Database.Database; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-restore-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const app = buildApp(db, { artifactsRoot: join(dir, 'artifacts') });
  return { app, db, dir };
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

describe('Restore API（P8-05 恢复演练）', () => {
  it('备份 → 恢复到新路径 → 恢复库可打开且 schema 完整', async () => {
    const { app, dir } = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: {
        schemaVersion: 'workbench.project/v1',
        project: { id: 'demo-project', name: '示例项目' },
        runtime: { root: '.' },
        commands: [{ id: 'start-web', type: 'service', executable: 'node' }],
      },
    });
    const backupDir = join(dir, 'backup');
    await app.inject({ method: 'POST', url: '/api/v1/backup', payload: { dir: backupDir } });

    const targetDbPath = join(dir, 'restored', 'restored.db');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/restore',
      payload: { backupDir, targetDbPath },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; schemaTables: number };
    expect(body.ok).toBe(true);
    expect(body.schemaTables).toBeGreaterThan(0);

    // 恢复库可打开且包含 projects 表
    const restored = new Database(targetDbPath, { readonly: true });
    const names = restored.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
      name: string;
    }[];
    restored.close();
    expect(names.some((r) => r.name === 'projects')).toBe(true);
  });

  it('备份被篡改后恢复失败（422）', async () => {
    const { app, dir } = setup();
    const backupDir = join(dir, 'backup');
    await app.inject({ method: 'POST', url: '/api/v1/backup', payload: { dir: backupDir } });
    const { appendFileSync } = await import('node:fs');
    appendFileSync(join(backupDir, 'db.sqlite'), Buffer.from('tamper'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/restore',
      payload: { backupDir, targetDbPath: join(dir, 'restored.db') },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe('BACKUP_INVALID');
  });
});
