import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { ExtensionSpec } from '@workbench/contracts';
import { openConnection } from '../connection.js';
import { runMigrations } from '../migration-runner.js';
import { migrations } from '../migrations/index.js';
import { ExtensionStore } from '../extension-store.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function newStore(): ExtensionStore {
  const dir = mkdtempSync(join(tmpdir(), 'wb-ext-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return new ExtensionStore(db);
}

function spec(version: string, name = '会议纪要助手'): ExtensionSpec {
  return {
    schemaVersion: 'workbench.extension/v1',
    extension: { id: 'meeting-minutes', name, version, types: ['assistant'] },
    scope: { install: 'global', run: 'project' },
    permissions: {
      files: { read: ['inputs/**'], write: ['artifacts/**'] },
      commands: [],
      network: false,
      credentials: [],
    },
    model: { defaultProfileId: 'local-meeting' },
  };
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

describe('ExtensionStore（§6 + §8.2）', () => {
  it('register 创建扩展 + draft 版本', () => {
    const store = newStore();
    const version = store.register(spec('0.1.0'));
    expect(version.status).toBe('draft');
    expect(version.extensionId).toBe('meeting-minutes');
    expect(store.listExtensions()).toHaveLength(1);
  });

  it('内容寻址：同内容 register 幂等返回同一版本', () => {
    const store = newStore();
    const v1 = store.register(spec('0.1.0'));
    const v2 = store.register(spec('0.1.0'));
    expect(v2.id).toBe(v1.id);
    expect(store.listVersions('meeting-minutes')).toHaveLength(1);
  });

  it('升级生成新版本', () => {
    const store = newStore();
    store.register(spec('0.1.0'));
    const v2 = store.register(spec('0.2.0', '会议纪要助手 v2'));
    expect(v2.version).toBe('0.2.0');
    expect(store.listVersions('meeting-minutes')).toHaveLength(2);
  });

  it('publish→install 流转并自动启用首个版本', () => {
    const store = newStore();
    const v = store.register(spec('0.1.0'));
    store.publishVersion(v.id);
    expect(store.getVersion(v.id)?.status).toBe('published');

    store.installVersion(v.id);
    expect(store.getVersion(v.id)?.status).toBe('installed');
    expect(store.getExtension('meeting-minutes')?.enabledVersionId).toBe(v.id);
  });

  it('draft 版本不可 install', () => {
    const store = newStore();
    const v = store.register(spec('0.1.0'));
    expect(() => store.installVersion(v.id)).toThrow(/未发布/);
  });

  it('enableVersion 切换到指定版本', () => {
    const store = newStore();
    const v1 = store.register(spec('0.1.0'));
    store.publishVersion(v1.id);
    store.installVersion(v1.id);

    const v2 = store.register(spec('0.2.0'));
    store.publishVersion(v2.id);
    store.installVersion(v2.id);
    store.enableVersion('meeting-minutes', v2.id);

    expect(store.getExtension('meeting-minutes')?.enabledVersionId).toBe(v2.id);
  });
});
