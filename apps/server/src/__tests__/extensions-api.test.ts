import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { ExtensionSpec } from '@workbench/contracts';
import { ExtensionStore, migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function makeSpec(version: string, overrides: Partial<ExtensionSpec> = {}): ExtensionSpec {
  return {
    schemaVersion: 'workbench.extension/v1',
    extension: { id: 'meeting-minutes', name: '会议纪要助手', version, types: ['assistant'] },
    scope: { install: 'global', run: 'project' },
    permissions: {
      files: { read: ['inputs/**'], write: ['artifacts/**'] },
      commands: [],
      network: false,
      credentials: [],
    },
    ...overrides,
  };
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-extapi-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const store = new ExtensionStore(db);
  const v1 = store.register(makeSpec('0.1.0'));
  store.publishVersion(v1.id);
  const app = buildApp(db);
  return { db, app, store, v1 };
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

describe('扩展生命周期 API（§10.3 install/enable/rollback）', () => {
  it('install 已发布版本并自动启用（首次安装无需审批）', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/meeting-minutes/versions/0.1.0/install',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { version: { status: string }; requiresApproval: boolean };
    expect(body.version.status).toBe('installed');
    expect(body.requiresApproval).toBe(false);

    const list = await app.inject({ method: 'GET', url: '/api/v1/extensions' });
    expect((list.json() as { total: number }).total).toBe(1);
  });

  it('升级权限扩大 → permissionDiff.expanded 且 requiresApproval', async () => {
    const { app, store } = await setup();
    // 先安装 v0.1.0
    await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/meeting-minutes/versions/0.1.0/install',
    });

    // v0.2.0 权限扩大（network: true + 新增读路径）
    const v2 = store.register(
      makeSpec('0.2.0', {
        permissions: {
          files: { read: ['inputs/**', 'meetings/**'], write: ['artifacts/**'] },
          commands: [],
          network: true,
          credentials: [],
        },
      }),
    );
    store.publishVersion(v2.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/meeting-minutes/versions/0.2.0/enable',
    });
    const body = res.json() as {
      permissionDiff: { addedRead: string[]; networkEnabled: boolean; expanded: boolean };
      requiresApproval: boolean;
    };
    expect(body.permissionDiff.addedRead).toContain('meetings/**');
    expect(body.permissionDiff.networkEnabled).toBe(true);
    expect(body.permissionDiff.expanded).toBe(true);
    expect(body.requiresApproval).toBe(true);
  });

  it('rollback 回退到上一个已安装版本', async () => {
    const { app, store, v1 } = await setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/meeting-minutes/versions/0.1.0/install',
    });

    const v2 = store.register(makeSpec('0.2.0'));
    store.publishVersion(v2.id);
    await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/meeting-minutes/versions/0.2.0/install',
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/meeting-minutes/versions/0.2.0/enable',
    });

    const rollback = await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/meeting-minutes/rollback',
    });
    expect(rollback.statusCode).toBe(200);
    expect((rollback.json() as { enabledVersionId: string }).enabledVersionId).toBe(v1.id);
  });

  it('draft 版本 install → 409 EXTENSION_NOT_INSTALLABLE', async () => {
    const { app, store } = await setup();
    const v2 = store.register(makeSpec('0.2.0')); // 未 publish
    expect(v2.status).toBe('draft');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/meeting-minutes/versions/0.2.0/install',
    });
    expect(res.statusCode).toBe(409);
  });

  it('不存在的扩展 install → 404', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/nope/versions/0.1.0/install',
    });
    expect(res.statusCode).toBe(404);
  });
});
