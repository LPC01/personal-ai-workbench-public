import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { ProjectCommand } from '@workbench/contracts';
import { AppError } from '@workbench/domain';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { CommandRegistry, validateCommandArguments } from '../command-registry.js';

const tmpDirs: string[] = [];

function tmpDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'wb-cmd-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  runMigrations(db, migrations);
  return db;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const command: ProjectCommand = {
  id: 'start-web',
  type: 'service',
  executable: 'node',
  arguments: ['server.js'],
  concurrency: 'singleton',
};

function insertProject(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO projects (id, name, root_path, manifest_hash, manifest_json, status, created_at, updated_at)
     VALUES (?, 'x', '.', 'hash', '{}', 'registered', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  ).run(id);
}

describe('CommandRegistry', () => {
  it('registers commands and lists them', () => {
    const db = tmpDb();
    const registry = new CommandRegistry(db);
    insertProject(db, 'demo-project');
    registry.registerCommands('demo-project', [command]);
    const items = registry.listCommands('demo-project');
    expect(items).toHaveLength(1);
    expect(items[0]?.commandId).toBe('start-web');
    expect(items[0]?.revision).toBe(1);
    expect(items[0]?.definitionHash).toHaveLength(64);
    db.close();
  });

  it('reuses revision when definition is unchanged', () => {
    const db = tmpDb();
    const registry = new CommandRegistry(db);
    insertProject(db, 'demo-project');
    registry.registerCommands('demo-project', [command]);
    registry.registerCommands('demo-project', [command]);
    expect(registry.getCommand('demo-project', 'start-web')?.revision).toBe(1);
    db.close();
  });

  it('bumps revision when definition changes', () => {
    const db = tmpDb();
    const registry = new CommandRegistry(db);
    insertProject(db, 'demo-project');
    registry.registerCommands('demo-project', [command]);
    const changed = { ...command, timeoutSeconds: 30 };
    registry.registerCommands('demo-project', [changed]);
    expect(registry.getCommand('demo-project', 'start-web')?.revision).toBe(2);
    db.close();
  });

  it('returns undefined for missing command', () => {
    const db = tmpDb();
    const registry = new CommandRegistry(db);
    insertProject(db, 'demo-project');
    expect(registry.getCommand('demo-project', 'nope')).toBeUndefined();
    db.close();
  });
});

describe('validateCommandArguments', () => {
  it('accepts an array of strings', () => {
    expect(validateCommandArguments(['-NoProfile', 'server.js'])).toEqual([
      '-NoProfile',
      'server.js',
    ]);
  });

  it('rejects non-array input', () => {
    expect(() => validateCommandArguments('not-array')).toThrow(AppError);
  });

  it('rejects non-string elements', () => {
    expect(() => validateCommandArguments([1, 2])).toThrow(AppError);
  });

  it('rejects null byte injection', () => {
    expect(() => validateCommandArguments(['a\0b'])).toThrow(AppError);
  });

  it('rejects unresolved glob patterns', () => {
    expect(() => validateCommandArguments(['*.js'])).toThrow(AppError);
    expect(() => validateCommandArguments(['a?b'])).toThrow(AppError);
  });
});
