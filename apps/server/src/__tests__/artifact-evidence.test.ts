import { createHash } from 'node:crypto';
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
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-artev-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const runId = new RunStore(db).createRun({ kind: 'agent' }).id;
  const root = join(dir, 'artifacts');
  return { db, runId, root, artifactStore: new ArtifactStore(db, root) };
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

const sha256 = (content: Buffer) => createHash('sha256').update(content).digest('hex');

describe('Markdown/JSON Artifact 与证据引用（P5-09）', () => {
  it('Markdown Artifact：mediaType 正确 + sha256 内容寻址证据', async () => {
    const { db, runId, root, artifactStore } = setup();
    const content = Buffer.from('# 会议纪要\n\n## 结论\n', 'utf8');
    const art = artifactStore.create({
      runId,
      kind: 'report',
      logicalName: 'minutes.md',
      mediaType: 'text/markdown',
      content,
    });

    // sha256 内容寻址证据：等于内容哈希
    expect(art.sha256).toBe(sha256(content));
    expect(art.mediaType).toBe('text/markdown');

    // 下载端点返回正确 Content-Type 与内容
    const app = buildApp(db, { artifactsRoot: root });
    const res = await app.inject({ method: 'GET', url: `/api/v1/artifacts/${art.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.body).toBe(content.toString('utf8'));
  });

  it('JSON Artifact：结构化内容 + application/json', async () => {
    const { db, runId, root, artifactStore } = setup();
    const json = JSON.stringify({ summary: '结论', actionItems: ['a', 'b'] });
    const art = artifactStore.create({
      runId,
      kind: 'report',
      logicalName: 'minutes.json',
      mediaType: 'application/json',
      content: Buffer.from(json, 'utf8'),
    });

    expect(art.mediaType).toBe('application/json');
    expect(art.sha256).toBe(sha256(Buffer.from(json, 'utf8')));

    const app = buildApp(db, { artifactsRoot: root });
    const res = await app.inject({ method: 'GET', url: `/api/v1/artifacts/${art.id}` });
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.body)).toEqual({ summary: '结论', actionItems: ['a', 'b'] });
  });

  it('证据引用：runId 溯源 + 列表返回完整证据链', async () => {
    const { db, runId, root, artifactStore } = setup();
    const art = artifactStore.create({
      runId,
      kind: 'report',
      logicalName: 'minutes.md',
      mediaType: 'text/markdown',
      content: Buffer.from('# 纪要'),
    });

    const app = buildApp(db, { artifactsRoot: root });
    const res = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}/artifacts` });
    const body = res.json() as {
      runId: string;
      items: { id: string; runId: string; sha256: string; logicalName: string }[];
    };
    expect(body.runId).toBe(runId);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.runId).toBe(runId);
    expect(body.items[0]?.sha256).toBe(art.sha256);
    expect(body.items[0]?.logicalName).toBe('minutes.md');
  });
});
