import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openConnection } from '../connection.js';
import { runMigrations } from '../migration-runner.js';
import { migrations } from '../migrations/index.js';
import { HarnessProfileStore } from '../harness-profile-store.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function newStore(): HarnessProfileStore {
  const dir = mkdtempSync(join(tmpdir(), 'wb-harness-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return new HarnessProfileStore(db);
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

describe('HarnessProfileStore', () => {
  it('upsert 新建（revision 1）并可 get', () => {
    const store = newStore();
    const profile = store.upsert({
      id: 'deepseek-harness-local',
      name: 'DeepSeek Harness',
      adapterType: 'deepseek',
      config: { baseUrl: 'http://127.0.0.1:8123' },
    });
    expect(profile.revision).toBe(1);
    expect(profile.adapterType).toBe('deepseek');
    expect(profile.config).toEqual({ baseUrl: 'http://127.0.0.1:8123' });
    expect(store.get('deepseek-harness-local')?.name).toBe('DeepSeek Harness');
  });

  it('upsert 已存在时修订号 +1', () => {
    const store = newStore();
    store.upsert({ id: 'p', name: 'a', adapterType: 'deepseek' });
    const updated = store.upsert({
      id: 'p',
      name: 'b',
      adapterType: 'deepseek',
      config: { baseUrl: 'x' },
    });
    expect(updated.revision).toBe(2);
    expect(updated.name).toBe('b');
    expect(store.list()).toHaveLength(1);
  });

  it('list 返回全部 profile', () => {
    const store = newStore();
    store.upsert({ id: 'a', name: 'A', adapterType: 'deepseek' });
    store.upsert({ id: 'b', name: 'B', adapterType: 'mock' });
    expect(store.list().map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('get 不存在的 profile 返回 undefined', () => {
    expect(newStore().get('nope')).toBeUndefined();
  });
});
