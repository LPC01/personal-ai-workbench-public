import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, ModelUsageStore, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';
import { ModelUsageService } from '../model-usage-service.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { app: ReturnType<typeof buildApp>; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-usage-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return { app: buildApp(db), db };
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

describe('Usage API（P8-02 模型使用量/延迟/成本）', () => {
  it('记录 → overview/by-model/by-day 聚合', async () => {
    const { app } = setup();
    await app.inject({
      method: 'POST',
      url: '/api/v1/usage',
      payload: {
        modelId: 'gpt-4o-mini',
        promptTokens: 100,
        completionTokens: 50,
        latencyMs: 320,
        cost: 0.012,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/usage',
      payload: {
        modelId: 'gpt-4o-mini',
        promptTokens: 200,
        completionTokens: 80,
        latencyMs: 400,
        cost: 0.02,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/usage',
      payload: {
        modelId: 'qwen-local',
        promptTokens: 300,
        completionTokens: 100,
        latencyMs: 150,
        cost: 0,
      },
    });

    const overview = await app.inject({ method: 'GET', url: '/api/v1/usage/overview' });
    const ov = overview.json() as {
      totalCalls: number;
      totalPromptTokens: number;
      totalCost: number;
    };
    expect(ov.totalCalls).toBe(3);
    expect(ov.totalPromptTokens).toBe(600);
    expect(ov.totalCost).toBeCloseTo(0.032, 5);

    const byModel = await app.inject({ method: 'GET', url: '/api/v1/usage/by-model' });
    const bm = byModel.json() as { modelId: string; calls: number; totalCost: number }[];
    expect(bm).toHaveLength(2);
    const gpt = bm.find((m) => m.modelId === 'gpt-4o-mini');
    expect(gpt?.calls).toBe(2);
    expect(gpt?.totalCost).toBeCloseTo(0.032, 5);

    const byDay = await app.inject({ method: 'GET', url: '/api/v1/usage/by-day' });
    const bd = byDay.json() as { day: string; calls: number }[];
    expect(bd).toHaveLength(1);
    expect(bd[0]?.calls).toBe(3);
  });

  it('成本未传时按定价映射计算', () => {
    const db = openConnection({ path: ':memory:' });
    runMigrations(db, migrations);
    const store = new ModelUsageStore(db);
    const service = new ModelUsageService(store, {
      'gpt-4o-mini': { inputPerToken: 0.0001, outputPerToken: 0.0002 },
    });
    const rec = service.record({
      modelId: 'gpt-4o-mini',
      promptTokens: 1000,
      completionTokens: 500,
      latencyMs: 100,
    });
    // 1000*0.0001 + 500*0.0002 = 0.1 + 0.1 = 0.2
    expect(rec.cost).toBeCloseTo(0.2, 5);
    db.close();
  });
});
