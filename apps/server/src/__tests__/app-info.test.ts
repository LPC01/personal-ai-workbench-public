import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';
import { resolveDataDir } from '../data-dir.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { app: ReturnType<typeof buildApp>; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-appinfo-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const app = buildApp(db, { dataDirConfig: resolveDataDir({ WB_DATA_DIR: join(dir, 'data') }) });
  return { app, db };
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

describe('data-dir 解析', () => {
  it('默认值', () => {
    const cfg = resolveDataDir({});
    expect(cfg.dataDir).toBe('var');
    expect(cfg.dbPath).toBe('var/workbench.db');
    expect(cfg.artifactsPath).toBe('var/artifacts');
  });

  it('WB_DATA_DIR 覆盖根目录，db/artifacts 跟随', () => {
    const cfg = resolveDataDir({ WB_DATA_DIR: 'D:/appdata' });
    expect(cfg.dataDir).toBe('D:/appdata');
    expect(cfg.dbPath).toBe('D:/appdata/workbench.db');
    expect(cfg.artifactsPath).toBe('D:/appdata/artifacts');
  });

  it('WB_DB / WB_ARTIFACTS 可单独覆盖', () => {
    const cfg = resolveDataDir({ WB_DB: 'X:/db.sqlite', WB_ARTIFACTS: 'Y:/arts' });
    expect(cfg.dbPath).toBe('X:/db.sqlite');
    expect(cfg.artifactsPath).toBe('Y:/arts');
  });
});

describe('App Info API（P8-06）', () => {
  it('返回版本与数据目录', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/app-info' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { version: string; dataDir: string; dbPath: string };
    expect(body.version).toBe('0.1.0');
    expect(body.dataDir).toContain('data');
    expect(body.dbPath).toContain('workbench.db');
  });
});
