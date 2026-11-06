import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { InMemoryCredentialStore } from '@workbench/model-gateway';
import {
  ApprovalStore,
  migrations,
  ModelGatewayStore,
  openConnection,
  runMigrations,
} from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];
const servers: Server[] = [];

async function startServer(status: number, content: string): Promise<string> {
  return new Promise((resolve) => {
    const srv = createServer((_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(content);
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
  approvals: ApprovalStore;
} {
  const dir = mkdtempSync(join(tmpdir(), 'wb-chat-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const credentialStore = new InMemoryCredentialStore();
  return {
    app: buildApp(db, { credentialStore }),
    store: new ModelGatewayStore(db),
    credentialStore,
    approvals: new ApprovalStore(db),
  };
}

function registerCloudProfile(
  store: ModelGatewayStore,
  url: string,
  credentialStore: InMemoryCredentialStore,
): void {
  store.upsertProvider({
    id: 'prov_cloud',
    name: 'Cloud',
    type: 'openai-compatible',
    baseUrl: url,
    credentialRef: 'cred_1',
  });
  store.upsertProfile({
    id: 'prof_cloud',
    name: 'Cloud GPT',
    providerId: 'prov_cloud',
    modelId: 'gpt-4o-mini',
    capabilities: ['chat'],
    contextLimit: 128000,
    dataBoundary: 'cloud',
  });
  void credentialStore.put({ ref: 'cred_1', type: 'api_key', secret: 'sk-ok' });
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

describe('models chat（CRED-04 鉴权 + 云端审批）', () => {
  it('cloud profile 未审批 → APPROVAL_REQUIRED', async () => {
    const url = await startServer(
      200,
      JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
    );
    const { app, store, credentialStore } = setup();
    registerCloudProfile(store, url, credentialStore);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/model-profiles/prof_cloud/chat',
      payload: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('APPROVAL_REQUIRED');
  });

  it('cloud profile 已审批 → chat 成功', async () => {
    const url = await startServer(
      200,
      JSON.stringify({ choices: [{ message: { content: 'hello back' } }] }),
    );
    const { app, store, credentialStore, approvals } = setup();
    registerCloudProfile(store, url, credentialStore);
    const approval = approvals.create({
      actionType: 'local-to-cloud',
      targetRef: 'prof_cloud',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    approvals.decide(approval.id, true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/model-profiles/prof_cloud/chat',
      payload: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { content: string }).content).toBe('hello back');
  });

  it('local-only profile 无需审批直接调用', async () => {
    const url = await startServer(200, JSON.stringify({ message: { content: 'local ok' } }));
    const { app, store, credentialStore } = setup();
    store.upsertProvider({ id: 'prov_local', name: 'Local', type: 'ollama', baseUrl: url });
    store.upsertProfile({
      id: 'prof_local',
      name: 'Local LLM',
      providerId: 'prov_local',
      modelId: 'qwen-local',
      capabilities: ['chat'],
      contextLimit: 32000,
      dataBoundary: 'local-only',
    });
    void credentialStore;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/model-profiles/prof_local/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { content: string }).content).toBe('local ok');
  });

  it('错误凭据（401）→ CREDENTIAL_INVALID，不泄露原始 Secret', async () => {
    const url = await startServer(401, JSON.stringify({ error: 'unauthorized' }));
    const { app, store, credentialStore, approvals } = setup();
    registerCloudProfile(store, url, credentialStore);
    const approval = approvals.create({
      actionType: 'local-to-cloud',
      targetRef: 'prof_cloud',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    approvals.decide(approval.id, true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/model-profiles/prof_cloud/chat',
      payload: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('CREDENTIAL_INVALID');
    expect(JSON.stringify(body)).not.toContain('sk-ok');
  });
});
