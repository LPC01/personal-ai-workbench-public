import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openConnection } from '../connection.js';
import { runMigrations } from '../migration-runner.js';
import { migrations } from '../migrations/index.js';
import { ModelGatewayStore } from '../model-gateway-store.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function newStore(): ModelGatewayStore {
  const dir = mkdtempSync(join(tmpdir(), 'wb-model-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return new ModelGatewayStore(db);
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

describe('ModelGatewayStore', () => {
  it('upserts a provider with revision 1 and increments on update', () => {
    const store = newStore();
    const p1 = store.upsertProvider({
      id: 'local-ollama',
      name: 'Ollama',
      type: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
    });
    expect(p1.revision).toBe(1);

    const p2 = store.upsertProvider({
      id: 'local-ollama',
      name: 'Ollama v2',
      type: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
    });
    expect(p2.revision).toBe(2);
    expect(p2.name).toBe('Ollama v2');
  });

  it('stores profile fields and increments revision', () => {
    const store = newStore();
    store.upsertProvider({ id: 'local-ollama', name: 'Ollama', type: 'ollama' });
    const profile = store.upsertProfile({
      id: 'local-meeting',
      name: '会议纪要',
      providerId: 'local-ollama',
      modelId: 'qwen-local',
      capabilities: ['chat', 'structured-output'],
      contextLimit: 32768,
      defaultParams: { temperature: 0.3 },
      dataBoundary: 'local-only',
    });
    expect(profile.revision).toBe(1);
    expect(profile.capabilities).toEqual(['chat', 'structured-output']);
    expect(profile.defaultParams).toEqual({ temperature: 0.3 });
    expect(profile.fallbackProfileId).toBeNull();

    const updated = store.upsertProfile({
      id: 'local-meeting',
      name: '会议纪要',
      providerId: 'local-ollama',
      modelId: 'qwen-local',
      capabilities: ['chat'],
      contextLimit: 65536,
      dataBoundary: 'local-only',
      fallbackProfileId: 'cloud-reasoning',
    });
    expect(updated.revision).toBe(2);
    expect(updated.contextLimit).toBe(65536);
    expect(updated.fallbackProfileId).toBe('cloud-reasoning');
  });

  it('lists providers and profiles', () => {
    const store = newStore();
    store.upsertProvider({ id: 'a', name: 'A', type: 'ollama' });
    store.upsertProvider({ id: 'b', name: 'B', type: 'openai-compatible' });
    store.upsertProfile({
      id: 'p1',
      name: 'P1',
      providerId: 'a',
      modelId: 'm',
      capabilities: [],
      contextLimit: 100,
      dataBoundary: 'cloud',
    });
    expect(store.listProviders()).toHaveLength(2);
    expect(store.listProfiles()).toHaveLength(1);
    expect(store.getProvider('missing')).toBeUndefined();
    expect(store.getProfile('missing')).toBeUndefined();
  });
});
