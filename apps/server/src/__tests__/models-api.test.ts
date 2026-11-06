import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];
const servers: Server[] = [];

function setup(): ReturnType<typeof buildApp> {
  const dir = mkdtempSync(join(tmpdir(), 'wb-modelapi-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return buildApp(db);
}

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()?.close();
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  for (const s of servers) {
    s.closeAllConnections?.();
    s.close();
  }
  servers.length = 0;
});

describe('models API', () => {
  it('upserts a provider and increments revision', async () => {
    const app = setup();
    const body = {
      id: 'local-ollama',
      name: 'Ollama',
      type: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/model-providers',
      payload: body,
    });
    expect((first.json() as { revision: number }).revision).toBe(1);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/model-providers',
      payload: body,
    });
    expect((second.json() as { revision: number }).revision).toBe(2);

    const list = await app.inject({ method: 'GET', url: '/api/v1/model-providers' });
    expect((list.json() as { total: number }).total).toBe(1);
  });

  it('upserts a profile and lists it', async () => {
    const app = setup();
    const profile = {
      id: 'local-meeting',
      name: '会议纪要',
      providerId: 'local-ollama',
      modelId: 'qwen-local',
      capabilities: ['chat'],
      contextLimit: 32768,
      dataBoundary: 'local-only',
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/model-profiles',
      payload: profile,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { revision: number }).revision).toBe(1);

    const list = await app.inject({ method: 'GET', url: '/api/v1/model-profiles' });
    const body = list.json() as { items: { id: string; dataBoundary: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.dataBoundary).toBe('local-only');
  });

  it('probes a provider and returns healthy + models', async () => {
    const app = setup();
    const port = await new Promise<number>((resolve) => {
      const server = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'llama3' }] }));
      });
      server.listen(0, '127.0.0.1', () => {
        servers.push(server);
        resolve((server.address() as { port: number }).port);
      });
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/model-providers',
      payload: {
        id: 'local-ollama',
        name: 'Ollama',
        type: 'ollama',
        baseUrl: `http://127.0.0.1:${port}`,
      },
    });

    const probe = await app.inject({
      method: 'POST',
      url: '/api/v1/model-providers/local-ollama/probe',
    });
    expect(probe.statusCode).toBe(200);
    const body = probe.json() as { healthy: boolean; models: string[] };
    expect(body.healthy).toBe(true);
    expect(body.models).toEqual(['llama3']);
  });

  it('returns 404 when probing a missing provider', async () => {
    const app = setup();
    const res = await app.inject({ method: 'POST', url: '/api/v1/model-providers/nope/probe' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('MODEL_PROVIDER_NOT_FOUND');
  });
});
