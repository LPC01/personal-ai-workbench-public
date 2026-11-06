import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { app: ReturnType<typeof buildApp>; db: Database.Database; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-backup-'));
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

interface BackupManifest {
  schemaVersion: string;
  files: { name: string; sha256: string }[];
}

describe('Backup API（P8-04 备份与哈希校验）', () => {
  it('创建备份 → 校验通过', async () => {
    const { app, dir } = setup();
    const backupDir = join(dir, 'backup');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/backup',
      payload: { dir: backupDir },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { manifest: BackupManifest };
    expect(body.manifest.schemaVersion).toBe('workbench.backup/v1');
    const names = body.manifest.files.map((f) => f.name).sort();
    expect(names).toEqual(
      [
        'artifacts.json',
        'config.json',
        'db.sqlite',
        'extensions.json',
        'memory.md',
        'projects.json',
      ].sort(),
    );

    const verify = await app.inject({
      method: 'GET',
      url: `/api/v1/backup/verify?dir=${encodeURIComponent(backupDir)}`,
    });
    expect(verify.statusCode).toBe(200);
    expect((verify.json() as { ok: boolean }).ok).toBe(true);
  });

  it('篡改文件后校验失败', async () => {
    const { app, dir } = setup();
    const backupDir = join(dir, 'backup');
    await app.inject({ method: 'POST', url: '/api/v1/backup', payload: { dir: backupDir } });
    appendFileSync(join(backupDir, 'db.sqlite'), Buffer.from('tamper'));

    const verify = await app.inject({
      method: 'GET',
      url: `/api/v1/backup/verify?dir=${encodeURIComponent(backupDir)}`,
    });
    const body = verify.json() as { ok: boolean; mismatches: unknown[] };
    expect(body.ok).toBe(false);
    expect(body.mismatches.length).toBeGreaterThan(0);
  });

  it('缺少 dir 返回 422', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/v1/backup', payload: {} });
    expect(res.statusCode).toBe(422);
  });
});
