import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openConnection } from '../connection.js';
import { runMigrations } from '../migration-runner.js';
import { migrations } from '../migrations/index.js';
import { ArtifactStore } from '../artifact-store.js';
import { RunStore } from '../run-store.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function newStore(): { db: Database.Database; store: ArtifactStore; runId: string; root: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-art-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const runId = new RunStore(db).createRun({ kind: 'job' }).id;
  const root = join(dir, 'artifacts');
  return { db, store: new ArtifactStore(db, root), runId, root };
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

describe('ArtifactStore', () => {
  it('stages, hashes and atomically publishes an artifact', () => {
    const { store, runId, root } = newStore();
    const content = Buffer.from('hello artifact');
    const art = store.create({ runId, kind: 'report', logicalName: 'out.md', content });

    expect(art.sha256).toBe(createHash('sha256').update(content).digest('hex'));
    expect(art.sizeBytes).toBe(content.length);
    expect(art.storageRef).toBe(art.id);

    expect(existsSync(join(root, art.id))).toBe(true);
    expect(store.readContent(art.id)?.toString()).toBe('hello artifact');
  });

  it('rolls back the file when the DB insert fails (invalid run_id)', () => {
    const { store, root } = newStore();
    expect(() =>
      store.create({
        runId: 'no-such-run',
        kind: 'report',
        logicalName: 'x.md',
        content: Buffer.from('boom'),
      }),
    ).toThrow();

    // 无孤儿文件残留
    const leftover = readdirSync(join(root, '.staging'));
    expect(leftover).toEqual([]);
  });

  it('does not overwrite a previous version when publish fails', () => {
    const { store, runId, root } = newStore();
    const first = store.create({
      id: 'art-v1',
      runId,
      kind: 'report',
      logicalName: 'r.md',
      content: Buffer.from('version-1'),
    });

    // 同 id 再次发布 → 主键冲突，上一版本文件内容不受影响
    expect(() =>
      store.create({
        id: 'art-v1',
        runId,
        kind: 'report',
        logicalName: 'r.md',
        content: Buffer.from('version-2'),
      }),
    ).toThrow();

    expect(readFileSync(join(root, first.id), 'utf8')).toBe('version-1');
    expect(store.readContent('art-v1')?.toString()).toBe('version-1');
  });

  it('lists artifacts by run', () => {
    const { store, runId } = newStore();
    store.create({ runId, kind: 'report', logicalName: 'a.md', content: Buffer.from('a') });
    store.create({ runId, kind: 'report', logicalName: 'b.md', content: Buffer.from('b') });
    expect(store.listByRun(runId)).toHaveLength(2);
  });
});
