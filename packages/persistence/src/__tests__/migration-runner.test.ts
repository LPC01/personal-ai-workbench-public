import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openConnection } from '../connection.js';
import { runMigrations, type Migration } from '../migration-runner.js';
import { migrations } from '../migrations/index.js';

const tmpDirs: string[] = [];

function tmpDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'wb-persist-'));
  tmpDirs.push(dir);
  return openConnection({ path: join(dir, 'test.db') });
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('connection', () => {
  it('enables WAL, foreign_keys and busy_timeout', () => {
    const db = tmpDb();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    db.close();
  });
});

describe('runMigrations', () => {
  it('applies migrations once and is idempotent on repeat', () => {
    const db = tmpDb();
    const first = runMigrations(db, migrations);
    expect(first.applied).toContain('init-app-meta');

    const second = runMigrations(db, migrations);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain('init-app-meta');
    db.close();
  });

  it('creates the migrated table', () => {
    const db = tmpDb();
    runMigrations(db, migrations);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta'")
      .get();
    expect(row).toBeTruthy();
    db.close();
  });

  it('rolls back a failing migration transactionally', () => {
    const db = tmpDb();
    const failing: Migration = {
      version: 1,
      name: 'failing',
      up: (d) => {
        d.exec('CREATE TABLE should_rollback (id INTEGER)');
        throw new Error('boom');
      },
    };
    expect(() => runMigrations(db, [failing])).toThrow(/boom/);

    const table = db.prepare("SELECT name FROM sqlite_master WHERE name='should_rollback'").get();
    expect(table).toBeUndefined();

    const count = db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as { c: number };
    expect(count.c).toBe(0);
    db.close();
  });

  it('throws on duplicate migration version', () => {
    const db = tmpDb();
    const dup: Migration[] = [
      { version: 1, name: 'a', up: () => {} },
      { version: 1, name: 'b', up: () => {} },
    ];
    expect(() => runMigrations(db, dup)).toThrow(/Duplicate migration version/);
    db.close();
  });
});
