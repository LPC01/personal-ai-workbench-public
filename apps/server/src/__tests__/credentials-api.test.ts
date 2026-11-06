import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { InMemoryCredentialStore } from '@workbench/model-gateway';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { app: ReturnType<typeof buildApp>; store: InMemoryCredentialStore } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-credapi-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const store = new InMemoryCredentialStore();
  return { app: buildApp(db, { credentialStore: store }), store };
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

describe('credentials API（CRED-02）', () => {
  it('POST 返回 descriptor（含掩码，不含明文 Secret）', async () => {
    const { app, store } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/credentials',
      payload: { type: 'api_key', secret: 'sk-very-secret-key-1234' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ref: string; type: string; masked: string; status: string };
    expect(body.ref).toMatch(/^cred_/);
    expect(body.type).toBe('api_key');
    expect(body.masked).toBe('****1234');
    expect(body.status).toBe('ACTIVE');
    expect(JSON.stringify(body)).not.toContain('sk-very-secret-key-1234');

    // 内部仅经 withSecret 闭包可用；HTTP 响应不含
    const got = await store.withSecret(body.ref, 'model_auth', async (secret) => secret);
    expect(got).toBe('sk-very-secret-key-1234');
  });

  it('GET /credentials/:ref 返回 descriptor 不含 Secret', async () => {
    const { app } = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/credentials',
      payload: { ref: 'cred_x', type: 'password', secret: 'p@ssw0rd' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/credentials/cred_x' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ref: string; masked: string };
    expect(body.ref).toBe('cred_x');
    expect(JSON.stringify(body)).not.toContain('p@ssw0rd');
  });

  it('GET 找不到时 404 CREDENTIAL_NOT_FOUND', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/credentials/nope' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CREDENTIAL_NOT_FOUND');
  });

  it('DELETE 后 withSecret 稳定失败', async () => {
    const { app, store } = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/credentials',
      payload: { ref: 'cred_x', type: 'api_key', secret: 'secret-value' },
    });
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/credentials/cred_x' });
    expect(del.statusCode).toBe(200);
    await expect(store.withSecret('cred_x', 'model_auth', async () => 1)).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
    });
  });

  it('rejects an empty secret（401 CREDENTIAL_INVALID）', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/credentials',
      payload: { secret: '' },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CREDENTIAL_INVALID');
  });
});
