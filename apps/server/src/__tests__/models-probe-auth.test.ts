import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { InMemoryCredentialStore } from '@workbench/model-gateway';
import {
  migrations,
  openConnection,
  runMigrations,
  ModelGatewayStore,
} from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];
const servers: Server[] = [];

async function startServer(
  handler: (headers: Record<string, string>) => [number, unknown],
): Promise<string> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const [status, body] = handler(req.headers as Record<string, string>);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    servers.push(srv);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function setup(): {
  app: ReturnType<typeof buildApp>;
  store: ModelGatewayStore;
  credentialStore: InMemoryCredentialStore;
} {
  const dir = mkdtempSync(join(tmpdir(), 'wb-probeauth-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const credentialStore = new InMemoryCredentialStore();
  return {
    app: buildApp(db, { credentialStore }),
    store: new ModelGatewayStore(db),
    credentialStore,
  };
}

afterEach(async () => {
  while (servers.length > 0) {
    await new Promise((r) => servers.pop()?.close(r));
  }
  while (openDbs.length > 0) {
    openDbs.pop()?.close();
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('models probe 鉴权（CRED-03）', () => {
  it('provider 绑定 credentialRef 时 probe 注入 apiKey', async () => {
    let authHeader = '';
    const url = await startServer((headers) => {
      authHeader = headers.authorization ?? '';
      return [200, { data: [{ id: 'gpt-4o-mini' }] }];
    });
    const { app, store, credentialStore } = setup();
    await credentialStore.put({ ref: 'cred_1', type: 'api_key', secret: 'sk-test-key' });
    store.upsertProvider({
      id: 'prov_1',
      name: 'Cloud',
      type: 'openai-compatible',
      baseUrl: url,
      credentialRef: 'cred_1',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/model-providers/prov_1/probe',
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { healthy: boolean }).healthy).toBe(true);
    expect(authHeader).toBe('Bearer sk-test-key');
  });

  it('错误凭据（401）归一化为 CREDENTIAL_INVALID', async () => {
    const url = await startServer(() => [401, { error: 'unauthorized' }]);
    const { app, store, credentialStore } = setup();
    await credentialStore.put({ ref: 'cred_1', type: 'api_key', secret: 'wrong-key' });
    store.upsertProvider({
      id: 'prov_1',
      name: 'Cloud',
      type: 'openai-compatible',
      baseUrl: url,
      credentialRef: 'cred_1',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/model-providers/prov_1/probe',
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CREDENTIAL_INVALID');
  });

  it('未绑定 credentialRef 时不注入鉴权头', async () => {
    let authHeader = 'sentinel';
    const url = await startServer((headers) => {
      authHeader = headers.authorization ?? '';
      return [200, { data: [{ id: 'qwen-local' }] }];
    });
    const { app, store } = setup();
    store.upsertProvider({ id: 'prov_1', name: 'Local', type: 'openai-compatible', baseUrl: url });

    const res = await app.inject({ method: 'POST', url: '/api/v1/model-providers/prov_1/probe' });
    expect(res.statusCode).toBe(200);
    expect(authHeader).toBe('');
  });
});
