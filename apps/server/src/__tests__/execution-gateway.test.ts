import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { HarnessToolRegistry, MockHarnessAdapter } from '@workbench/execution-gateway';
import type { HarnessAdapter, HarnessRunResponse } from '@workbench/execution-gateway';
import {
  HarnessSessionStore,
  migrations,
  openConnection,
  runMigrations,
  RunStore,
} from '@workbench/persistence';
import { RunStreamHub } from '@workbench/project-runtime';
import { ExecutionGateway } from '../execution-gateway.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function makeToolRegistry(): HarnessToolRegistry {
  const registry = new HarnessToolRegistry();
  registry.register({
    toolId: 'project.describe',
    async execute(args) {
      return { id: args.projectId, name: '示例' };
    },
  });
  return registry;
}

interface Ctx {
  runStore: RunStore;
  sessionStore: HarnessSessionStore;
  gateway: ExecutionGateway;
}

function setup(adapter: HarnessAdapter): Ctx {
  const dir = mkdtempSync(join(tmpdir(), 'wb-exec-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const runStore = new RunStore(db);
  const sessionStore = new HarnessSessionStore(db);
  const hub = new RunStreamHub();
  const gateway = new ExecutionGateway(adapter, makeToolRegistry(), runStore, sessionStore, hub);
  return { runStore, sessionStore, gateway };
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

/** 永不 resolve 的 Adapter，用于超时测试。 */
class HangingAdapter implements HarnessAdapter {
  async health() {
    return { ok: true };
  }
  run(): Promise<HarnessRunResponse> {
    return new Promise(() => {});
  }
  async *stream(): AsyncIterable<never> {
    // 空流
  }
  async cancel(): Promise<void> {}
}

const TOOL_TURN_SCRIPT: HarnessRunResponse[] = [
  {
    content: '我先查项目',
    toolCalls: [{ id: 't1', toolId: 'project.describe', arguments: { projectId: 'proj-1' } }],
    stopReason: 'tool',
  },
  { content: '完成', toolCalls: [], stopReason: 'end' },
];

describe('ExecutionGateway（执行网关闭环）', () => {
  it('start 创建 Agent Run + Session 绑定', async () => {
    const ctx = setup(new MockHarnessAdapter());
    const { session, run } = await ctx.gateway.start({
      harnessProfileId: 'hp-1',
      modelProfileId: 'mp-1',
      toolPolicy: { allowedToolIds: ['project.describe'], constraints: {} },
      prompt: '整理',
    });
    expect(run.kind).toBe('agent');
    expect(run.status).toBe('RUNNING');
    expect(session.runId).toBe(run.id);
  });

  it('runTurn 完成工具回环并到 SUCCEEDED，事件流含 tool_call/tool_result/message', async () => {
    const ctx = setup(new MockHarnessAdapter(TOOL_TURN_SCRIPT));
    const { session } = await ctx.gateway.start({
      harnessProfileId: 'hp-1',
      modelProfileId: 'mp-1',
      toolPolicy: { allowedToolIds: ['project.describe'], constraints: {} },
      prompt: '整理',
    });
    const run = await ctx.gateway.runTurn(session.id, '整理');
    expect(run.status).toBe('SUCCEEDED');

    const events = ctx.runStore.listRunEvents(run.id).map((e) => e.eventType);
    expect(events).toContain('tool_call');
    expect(events).toContain('tool_result');
    expect(events).toContain('message');
  });

  it('runTurn 超时 → FAILED(TIMEOUT)', async () => {
    const ctx = setup(new HangingAdapter());
    const { session } = await ctx.gateway.start({
      harnessProfileId: 'hp-1',
      modelProfileId: 'mp-1',
      toolPolicy: { allowedToolIds: [], constraints: {} },
      prompt: 'x',
    });
    const run = await ctx.gateway.runTurn(session.id, 'x', 1);
    expect(run.status).toBe('FAILED');
    expect(run.errorCode).toBe('TIMEOUT');
  });

  it('cancel 转 CANCELLED 并同步 Session 状态', async () => {
    const ctx = setup(new MockHarnessAdapter());
    const { session } = await ctx.gateway.start({
      harnessProfileId: 'hp-1',
      modelProfileId: 'mp-1',
      toolPolicy: { allowedToolIds: [], constraints: {} },
      prompt: 'x',
    });
    const run = await ctx.gateway.cancel(session.id);
    expect(run.status).toBe('CANCELLED');
    expect(ctx.sessionStore.get(session.id)?.status).toBe('cancelled');
  });

  it('resume 按 contextCursor 重放游标之后的事件', async () => {
    const ctx = setup(new MockHarnessAdapter(TOOL_TURN_SCRIPT));
    const { session } = await ctx.gateway.start({
      harnessProfileId: 'hp-1',
      modelProfileId: 'mp-1',
      toolPolicy: { allowedToolIds: ['project.describe'], constraints: {} },
      prompt: '整理',
    });
    await ctx.gateway.runTurn(session.id, '整理');

    // 假设已消费前 2 个事件
    ctx.sessionStore.updateCursor(session.id, 2);
    const resumed = ctx.gateway.resume(session.id);
    expect(resumed.session.contextCursor).toBe(2);
    expect(resumed.events.every((e) => e.sequence > 2)).toBe(true);
    expect(resumed.events.length).toBeGreaterThan(0);
  });
});
