import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { ProjectManifest } from '@workbench/contracts';
import {
  ArtifactStore,
  migrations,
  openConnection,
  runMigrations,
  RunStore,
} from '@workbench/persistence';
import { ProjectCatalog } from '@workbench/project-runtime';
import { buildReadOnlyToolRegistry } from '../harness-tools.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

interface Ctx {
  catalog: ProjectCatalog;
  runStore: RunStore;
  artifactStore: ArtifactStore;
  projectId: string;
  runId: string;
  artifactId: string;
}

function setup(): Ctx {
  const dir = mkdtempSync(join(tmpdir(), 'wb-tools-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);

  const catalog = new ProjectCatalog(db);
  const manifest: ProjectManifest = {
    schemaVersion: 'workbench.project/v1',
    project: { id: 'proj-1', name: '示例项目', description: '描述' },
    runtime: { root: 'D:/some/host/path' },
    commands: [{ id: 'build', type: 'job', executable: 'node', arguments: ['D:/secret/build.js'] }],
  };
  catalog.register(manifest);

  const runStore = new RunStore(db);
  const run = runStore.createRun({ projectId: 'proj-1', kind: 'job' });
  runStore.appendRunEvent(run.id, 'state', { from: 'CREATED' });

  const artifactStore = new ArtifactStore(db, join(dir, 'artifacts'));
  const artifact = artifactStore.create({
    runId: run.id,
    projectId: 'proj-1',
    kind: 'report',
    logicalName: 'summary.md',
    mediaType: 'text/markdown',
    content: Buffer.from('# 结果'),
  });

  return {
    catalog,
    runStore,
    artifactStore,
    projectId: 'proj-1',
    runId: run.id,
    artifactId: artifact.id,
  };
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

function serialize(result: unknown): string {
  return JSON.stringify(result);
}

describe('只读 Harness 工具（26 SPEC §13）', () => {
  it('project.describe 不返回主机绝对路径', async () => {
    const ctx = setup();
    const registry = buildReadOnlyToolRegistry(ctx.catalog, ctx.runStore, ctx.artifactStore);
    const result = await registry.execute(
      { id: 'c1', toolId: 'project.describe', arguments: { projectId: 'proj-1' } },
      { allowedToolIds: ['project.describe'], constraints: {} },
    );
    expect(result.ok).toBe(true);
    const json = serialize(result.data);
    expect(json).toContain('示例项目');
    expect(json).not.toContain('D:/some/host/path');
  });

  it('project.commands.list 不返回 executable/arguments', async () => {
    const ctx = setup();
    const registry = buildReadOnlyToolRegistry(ctx.catalog, ctx.runStore, ctx.artifactStore);
    const result = await registry.execute(
      { id: 'c2', toolId: 'project.commands.list', arguments: { projectId: 'proj-1' } },
      { allowedToolIds: ['project.commands.list'], constraints: {} },
    );
    expect(result.ok).toBe(true);
    const json = serialize(result.data);
    expect(json).toContain('build');
    expect(json).not.toContain('D:/secret/build.js');
  });

  it('run.status / run.events 返回状态与事件', async () => {
    const ctx = setup();
    const registry = buildReadOnlyToolRegistry(ctx.catalog, ctx.runStore, ctx.artifactStore);
    const status = await registry.execute(
      { id: 'c3', toolId: 'run.status', arguments: { runId: ctx.runId } },
      { allowedToolIds: ['run.status'], constraints: {} },
    );
    expect(status.ok).toBe(true);
    expect((status.data as { id: string }).id).toBe(ctx.runId);

    const events = await registry.execute(
      { id: 'c4', toolId: 'run.events', arguments: { runId: ctx.runId } },
      { allowedToolIds: ['run.events'], constraints: {} },
    );
    expect(events.ok).toBe(true);
    expect((events.data as { total: number }).total).toBe(1);
  });

  it('artifact.list / artifact.read 不返回 storage_ref 路径', async () => {
    const ctx = setup();
    const registry = buildReadOnlyToolRegistry(ctx.catalog, ctx.runStore, ctx.artifactStore);
    const list = await registry.execute(
      { id: 'c5', toolId: 'artifact.list', arguments: { runId: ctx.runId } },
      { allowedToolIds: ['artifact.list'], constraints: {} },
    );
    expect(list.ok).toBe(true);
    expect(serialize(list.data)).not.toContain('storageRef');

    const read = await registry.execute(
      { id: 'c6', toolId: 'artifact.read', arguments: { artifactId: ctx.artifactId } },
      { allowedToolIds: ['artifact.read'], constraints: {} },
    );
    expect(read.ok).toBe(true);
    const json = serialize(read.data);
    expect(json).toContain('# 结果');
    expect(json).not.toContain('storageRef');
  });

  it('策略未允许的工具被拒绝', async () => {
    const ctx = setup();
    const registry = buildReadOnlyToolRegistry(ctx.catalog, ctx.runStore, ctx.artifactStore);
    const result = await registry.execute(
      { id: 'c7', toolId: 'run.status', arguments: { runId: ctx.runId } },
      { allowedToolIds: ['project.describe'], constraints: {} },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('EXTENSION_PERMISSION_DENIED');
  });

  it('作用域：project.describe 拒绝越界项目', async () => {
    const ctx = setup();
    const registry = buildReadOnlyToolRegistry(ctx.catalog, ctx.runStore, ctx.artifactStore);
    const result = await registry.execute(
      { id: 'c8', toolId: 'project.describe', arguments: { projectId: 'proj-1' } },
      { allowedToolIds: ['project.describe'], constraints: {} },
      { projectId: 'other-proj', runId: null },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('EXTENSION_PERMISSION_DENIED');
  });

  it('作用域：run.status 拒绝越界 Run', async () => {
    const ctx = setup();
    const registry = buildReadOnlyToolRegistry(ctx.catalog, ctx.runStore, ctx.artifactStore);
    const result = await registry.execute(
      { id: 'c9', toolId: 'run.status', arguments: { runId: ctx.runId } },
      { allowedToolIds: ['run.status'], constraints: {} },
      { projectId: null, runId: 'other-run' },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('EXTENSION_PERMISSION_DENIED');
  });

  it('作用域：命中时放行', async () => {
    const ctx = setup();
    const registry = buildReadOnlyToolRegistry(ctx.catalog, ctx.runStore, ctx.artifactStore);
    const result = await registry.execute(
      { id: 'c10', toolId: 'project.describe', arguments: { projectId: 'proj-1' } },
      { allowedToolIds: ['project.describe'], constraints: {} },
      { projectId: 'proj-1', runId: null },
    );
    expect(result.ok).toBe(true);
  });
});
