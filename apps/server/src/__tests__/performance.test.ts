import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  ArtifactStore,
  migrations,
  openConnection,
  runMigrations,
  RunStore,
} from '@workbench/persistence';
import { InMemoryMemoryProvider } from '@workbench/memory-gateway';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function tmpDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'wb-perf-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return db;
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

describe('性能 / 长时间运行 / 磁盘上限（P8-08）', () => {
  it('migration 在合理时间内完成', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-perf-'));
    tmpDirs.push(dir);
    const db = openConnection({ path: join(dir, 'test.db') });
    openDbs.push(db);
    const start = Date.now();
    runMigrations(db, migrations);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('1000 次 Run 创建吞吐达标', () => {
    const db = tmpDb();
    const store = new RunStore(db);
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      store.createRun({ kind: 'job', input: { i } });
    }
    const elapsed = Date.now() - start;
    expect(store.listRuns()).toHaveLength(1000);
    expect(elapsed).toBeLessThan(5000);
  });

  it('Memory 1000 条召回达标', async () => {
    const provider = new InMemoryMemoryProvider();
    for (let i = 0; i < 1000; i++) {
      await provider.indexResource({ uri: `doc-${i}`, content: `记忆条目 ${i}`, scope: 'project' });
    }
    const start = Date.now();
    const hits = await provider.search({ query: '条目' });
    const elapsed = Date.now() - start;
    expect(hits.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
  });

  it('Artifact 磁盘上限：超限写入被拒绝', () => {
    const db = tmpDb();
    const run = new RunStore(db).createRun({ kind: 'job' });
    const dir = mkdtempSync(join(tmpdir(), 'wb-perf-art-'));
    tmpDirs.push(dir);
    // 上限 100 字节：第一次写 60 成功，第二次写 60 超限
    const store = new ArtifactStore(db, join(dir, 'artifacts'), 100);
    store.create({ runId: run.id, kind: 'report', logicalName: 'a', content: Buffer.alloc(60) });
    expect(() =>
      store.create({ runId: run.id, kind: 'report', logicalName: 'b', content: Buffer.alloc(60) }),
    ).toThrow(/磁盘配额超限/);
  });

  it('长时间运行后重启对账收敛非终态 Run', () => {
    const db = tmpDb();
    const store = new RunStore(db);
    const id = store.createRun({ kind: 'job' }).id;
    expect(store.getRun(id)?.status).toBe('CREATED');
    const reconciled = store.reconcileOnStartup();
    expect(reconciled.some((r) => r.runId === id)).toBe(true);
    expect(store.getRun(id)?.status).toBe('FAILED');
  });
});
