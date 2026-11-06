import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { ProjectManifest } from '@workbench/contracts';
import {
  ApprovalStore,
  ArtifactStore,
  migrations,
  openConnection,
  runMigrations,
  RunStore,
  type RunRecord,
} from '@workbench/persistence';
import { ProjectCatalog, RunStreamHub } from '@workbench/project-runtime';
import { JobRunner } from '../job-runner.js';
import { buildHarnessToolRegistry } from '../harness-tools.js';

const NODE = process.execPath;
const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/integration/fixtures/sample-job',
);

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

interface Ctx {
  catalog: ProjectCatalog;
  runStore: RunStore;
  artifactStore: ArtifactStore;
  approvalStore: ApprovalStore;
  jobRunner: JobRunner;
  registry: ReturnType<typeof buildHarnessToolRegistry>;
}

function setup(): Ctx {
  const dir = mkdtempSync(join(tmpdir(), 'wb-wtools-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);

  const catalog = new ProjectCatalog(db);
  const manifest: ProjectManifest = {
    schemaVersion: 'workbench.project/v1',
    project: { id: 'job-proj', name: 'Job 项目' },
    runtime: { root: FIXTURE },
    commands: [
      { id: 'ok', type: 'job', executable: NODE, arguments: ['success.js'] },
      { id: 'long', type: 'job', executable: NODE, arguments: ['long.js'] },
    ],
  };
  catalog.register(manifest);

  const runStore = new RunStore(db);
  const hub = new RunStreamHub();
  const jobRunner = new JobRunner(runStore, hub);
  const artifactStore = new ArtifactStore(db, join(dir, 'artifacts'));
  const approvalStore = new ApprovalStore(db);
  const registry = buildHarnessToolRegistry(
    catalog,
    runStore,
    artifactStore,
    jobRunner,
    approvalStore,
  );

  return { catalog, runStore, artifactStore, approvalStore, jobRunner, registry };
}

async function waitForTerminal(store: RunStore, runId: string): Promise<RunRecord> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const run = store.getRun(runId) as RunRecord;
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('run did not reach terminal');
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

describe('受控写工具（26 SPEC §13）', () => {
  it('project.command.run 在白名单内启动 job 到终态', async () => {
    const ctx = setup();
    const result = await ctx.registry.execute(
      {
        id: 'w1',
        toolId: 'project.command.run',
        arguments: { projectId: 'job-proj', commandId: 'ok' },
      },
      {
        allowedToolIds: ['project.command.run'],
        constraints: { 'project.command.run': { commandIds: ['ok'] } },
      },
    );
    expect(result.ok).toBe(true);
    const runId = (result.data as { runId: string }).runId;
    const run = await waitForTerminal(ctx.runStore, runId);
    expect(run.status).toBe('SUCCEEDED');
  });

  it('project.command.run 拒绝白名单外的命令（EXTENSION_PERMISSION_DENIED）', async () => {
    const ctx = setup();
    const result = await ctx.registry.execute(
      {
        id: 'w2',
        toolId: 'project.command.run',
        arguments: { projectId: 'job-proj', commandId: 'long' },
      },
      {
        allowedToolIds: ['project.command.run'],
        constraints: { 'project.command.run': { commandIds: ['ok'] } },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('EXTENSION_PERMISSION_DENIED');
  });

  it('project.command.run 拒绝未登记命令（COMMAND_NOT_REGISTERED）', async () => {
    const ctx = setup();
    const result = await ctx.registry.execute(
      {
        id: 'w3',
        toolId: 'project.command.run',
        arguments: { projectId: 'job-proj', commandId: 'nope' },
      },
      { allowedToolIds: ['project.command.run'], constraints: {} },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('COMMAND_NOT_REGISTERED');
  });

  it('run.cancel 取消进行中的 job', async () => {
    const ctx = setup();
    const start = await ctx.registry.execute(
      {
        id: 'w4',
        toolId: 'project.command.run',
        arguments: { projectId: 'job-proj', commandId: 'long' },
      },
      { allowedToolIds: ['project.command.run'], constraints: {} },
    );
    const runId = (start.data as { runId: string }).runId;
    const cancel = await ctx.registry.execute(
      { id: 'w5', toolId: 'run.cancel', arguments: { runId } },
      { allowedToolIds: ['run.cancel'], constraints: {} },
    );
    expect(cancel.ok).toBe(true);
    const run = await waitForTerminal(ctx.runStore, runId);
    expect(run.status).toBe('CANCELLED');
  });

  it('artifact.publish 发布成果并可读取', async () => {
    const ctx = setup();
    const start = await ctx.registry.execute(
      {
        id: 'w6',
        toolId: 'project.command.run',
        arguments: { projectId: 'job-proj', commandId: 'ok' },
      },
      { allowedToolIds: ['project.command.run'], constraints: {} },
    );
    const runId = (start.data as { runId: string }).runId;
    await waitForTerminal(ctx.runStore, runId);

    const publish = await ctx.registry.execute(
      {
        id: 'w7',
        toolId: 'artifact.publish',
        arguments: {
          runId,
          kind: 'report',
          logicalName: 'r.md',
          content: '# 结果',
          mediaType: 'text/markdown',
        },
      },
      { allowedToolIds: ['artifact.publish'], constraints: {} },
    );
    expect(publish.ok).toBe(true);
    expect(JSON.stringify(publish.data)).not.toContain('storageRef');
  });

  it('approval.request 创建 PENDING，approval.status 读取；不存在返回 APPROVAL_NOT_FOUND', async () => {
    const ctx = setup();
    const created = await ctx.registry.execute(
      {
        id: 'w8',
        toolId: 'approval.request',
        arguments: {
          actionType: 'local-to-cloud',
          targetRef: 'profile:cloud',
          request: { note: 'x' },
        },
      },
      { allowedToolIds: ['approval.request'], constraints: {} },
    );
    expect(created.ok).toBe(true);
    const approvalId = (created.data as { id: string }).id;

    const status = await ctx.registry.execute(
      { id: 'w9', toolId: 'approval.status', arguments: { approvalId } },
      { allowedToolIds: ['approval.status'], constraints: {} },
    );
    expect(status.ok).toBe(true);
    expect((status.data as { status: string }).status).toBe('PENDING');

    const missing = await ctx.registry.execute(
      { id: 'w10', toolId: 'approval.status', arguments: { approvalId: 'nope' } },
      { allowedToolIds: ['approval.status'], constraints: {} },
    );
    expect(missing.ok).toBe(false);
    expect(missing.errorCode).toBe('APPROVAL_NOT_FOUND');
  });
});
