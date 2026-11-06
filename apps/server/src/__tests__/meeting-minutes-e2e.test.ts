import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { HarnessToolRegistry, MockHarnessAdapter } from '@workbench/execution-gateway';
import {
  ArtifactStore,
  HarnessSessionStore,
  migrations,
  openConnection,
  runMigrations,
  RunStore,
} from '@workbench/persistence';
import { RunStreamHub } from '@workbench/project-runtime';
import { buildApp } from '../app.js';
import { ExecutionGateway } from '../execution-gateway.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-e2e-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const app = buildApp(db, { artifactsRoot: join(dir, 'artifacts') });
  return { db, dir, app };
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

describe('会议纪要助手端到端（§18.5 E2E）', () => {
  it('需求→Spec→草稿→验证→发布→安装→运行→回滚 全链路', async () => {
    const { db, dir, app } = setup();

    // 1. 需求对话 → 生成 Spec
    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/studio/sessions',
      payload: { title: '会议纪要助手' },
    });
    const sessionId = (session.json() as { id: string }).id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/studio/sessions/${sessionId}/messages`,
      payload: { role: 'user', content: '帮我整理会议纪要，输出 Markdown' },
    });
    const draft = await app.inject({
      method: 'POST',
      url: `/api/v1/studio/sessions/${sessionId}/generate-spec`,
    });
    const draftId = (draft.json() as { id: string }).id;

    // 2. Assistant 草稿（Prompt + 输入输出 Schema + 工具白名单）
    await app.inject({
      method: 'POST',
      url: `/api/v1/extension-drafts/${draftId}/assistant`,
      payload: {
        systemPrompt: '你是会议纪要助手，把会议原文整理为结构化纪要。',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        outputSchema: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
        },
        toolWhitelist: ['artifact.publish'],
        modelRequirements: { structuredOutput: true },
      },
    });

    // 3. 验证：build / test / eval 通过
    for (const kind of ['build', 'test', 'eval']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/extension-drafts/${draftId}/${kind}`,
      });
      expect((res.json() as { status: string }).status).toBe('passed');
    }

    // 4. 权限与数据流审阅
    const review = await app.inject({
      method: 'GET',
      url: `/api/v1/extension-drafts/${draftId}/permissions-review`,
    });
    expect((review.json() as { risks: unknown[] }).risks.length).toBeGreaterThan(0);

    // 5. 发布请求 → 正式版本
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/extension-drafts/${draftId}/publish-request`,
    });
    const version = (
      published.json() as { version: { id: string; version: string; extensionId: string } }
    ).version;
    expect(version.version).toBe('0.1.0');
    const extensionId = version.extensionId;

    // 6. 安装（自动启用）
    const installed = await app.inject({
      method: 'POST',
      url: `/api/v1/extensions/${extensionId}/versions/0.1.0/install`,
    });
    expect((installed.json() as { version: { status: string } }).version.status).toBe('installed');

    // 7. 运行：ExecutionGateway + MockHarnessAdapter 产出 Markdown Artifact
    const runStore = new RunStore(db);
    const sessionStore = new HarnessSessionStore(db);
    const artifactStore = new ArtifactStore(db, join(dir, 'artifacts'));
    const hub = new RunStreamHub();
    const tools = new HarnessToolRegistry();
    tools.register({
      toolId: 'artifact.publish',
      async execute(args, _policy, scope) {
        const artifact = artifactStore.create({
          runId: scope?.runId ?? String(args.runId),
          kind: String(args.kind),
          logicalName: String(args.logicalName),
          content: Buffer.from(String(args.content), 'utf8'),
          mediaType: typeof args.mediaType === 'string' ? args.mediaType : undefined,
        });
        return { id: artifact.id, kind: artifact.kind };
      },
    });
    const adapter = new MockHarnessAdapter([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            toolId: 'artifact.publish',
            arguments: {
              runId: '__run__',
              kind: 'report',
              logicalName: 'minutes.md',
              content: '# 会议纪要',
              mediaType: 'text/markdown',
            },
          },
        ],
        stopReason: 'tool',
      },
      { content: '已完成纪要', toolCalls: [], stopReason: 'end' },
    ]);
    const gateway = new ExecutionGateway(adapter, tools, runStore, sessionStore, hub);
    const started = await gateway.start({
      harnessProfileId: 'hp',
      modelProfileId: 'mp',
      toolPolicy: { allowedToolIds: ['artifact.publish'], constraints: {} },
      prompt: '整理会议纪要',
    });
    const run = await gateway.runTurn(started.session.id, '整理会议纪要');
    expect(run.status).toBe('SUCCEEDED');
    expect(artifactStore.listByRun(run.id).length).toBe(1);

    // 8. 回滚（无更早版本 → 409，符合预期）
    const rollback = await app.inject({
      method: 'POST',
      url: `/api/v1/extensions/${extensionId}/rollback`,
    });
    expect(rollback.statusCode).toBe(409);
  });
});
