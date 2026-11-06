/**
 * 联合 E2E 自动化回归（32 号 SPEC §7 十三步 + §8 v0.2 DoD）。
 *
 * 背景：十三步原先仅为手工 curl 验证（现已固化为本文件的自动化用例），
 * 回归依赖手工（known-limitations #9）。本文件把它固化为**确定性、离线可跑**的自动化测试。
 *
 * 环境隔离策略（避开既有两类环境性红灯）：
 * - **不开真实网络**：云 Provider 与 OpenViking 均由本地 stub HTTP 服务替代
 *   （`startModelStub` / `startMemoryStub`），测试不依赖 DeepSeek key、不依赖本机 OpenViking 运行态；
 * - **不落真实数据目录**：SQLite 与 Artifact 均写入临时目录；
 * - **注入 InMemory CredentialStore**：Windows DPAPI 不参与，避免平台耦合；
 * - **不 spawn 进程**：`executeCommand` 只创建平台 Run 记录（不真正启动服务）。
 *
 * 覆盖的真实链路：HTTP（`app.inject` 全量路由）→ 领域状态机（SDD 门禁 / Issue 四态 / Memory 审核）
 * → 持久化（SQLite）→ 外部适配器（OpenAI-compatible / Ollama / OpenViking 协议）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import {
  FallbackMemoryProvider,
  InMemoryMemoryProvider,
  OpenVikingAdapter,
} from '@workbench/memory-gateway';
import { InMemoryCredentialStore } from '@workbench/model-gateway';
import { buildApp } from '../app.js';

const PROJECT_ID = 'e2e-supply';
const OTHER_PROJECT_ID = 'e2e-other';

interface Stub {
  url: string;
  close(): Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function startStub(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): Promise<Stub> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      void Promise.resolve(handler(req, res)).catch(() => sendJson(res, 500, { error: 'stub' }));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/** 2-gram 重叠相似度：模拟语义检索的"改写查询仍可命中"。 */
function bigrams(text: string): string[] {
  const chars = [...text.replace(/[\s，。；：、（）()[\]]/g, '')];
  return chars.slice(0, -1).map((c, i) => c + (chars[i + 1] ?? ''));
}

function similarity(query: string, content: string): number {
  const q = bigrams(query);
  if (q.length === 0) return 0;
  const c = new Set(bigrams(content));
  return q.filter((g) => c.has(g)).length / q.length;
}

function startModelStub(): Promise<Stub> {
  return startStub(async (req, res) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && url === '/models') {
      return sendJson(res, 200, { data: [{ id: 'stub-designer' }, { id: 'stub-builder' }] });
    }
    if (req.method === 'POST' && url === '/chat/completions') {
      const body = JSON.parse(await readBody(req)) as { messages?: { content?: string }[] };
      const prompt = (body.messages ?? []).map((m) => m.content ?? '').join('\n');
      const content = prompt.includes('Spec')
        ? '示例项目 Spec：目标=统一供应数据；范围=采购与库存；验收标准=一致性校验通过、可追溯、可回滚'
        : 'Builder 实现完成：已按 Spec 修改代码并通过测试（Run 与 Artifact 已记录）';
      return sendJson(res, 200, {
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 11, completion_tokens: 22 },
      });
    }
    if (req.method === 'POST' && url === '/api/chat') {
      const body = JSON.parse(await readBody(req)) as { messages?: { content?: string }[] };
      const prompt = (body.messages ?? []).map((m) => m.content ?? '').join('\n');
      return sendJson(res, 200, {
        message: { content: `本地模型降级可用：${prompt.slice(0, 24)}` },
        prompt_eval_count: 5,
        eval_count: 6,
      });
    }
    return sendJson(res, 404, { error: 'not found' });
  });
}

function startMemoryStub(): Promise<Stub> {
  const resources: { uri: string; content: string }[] = [];
  let lastUpload = '';
  let counter = 0;
  return startStub(async (req, res) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && url === '/health') return sendJson(res, 200, { status: 'ok' });
    if (req.method === 'GET' && url === '/ready') return sendJson(res, 200, { status: 'ready' });
    if (req.method === 'POST' && url === '/api/v1/resources/temp_upload') {
      const raw = await readBody(req);
      const marker = raw.indexOf('\r\n\r\n');
      lastUpload =
        marker >= 0 ? (raw.slice(marker + 4).split('\r\n--')[0] ?? '') : raw.slice(0, 400);
      counter += 1;
      return sendJson(res, 200, { result: { temp_file_id: `tmp-${counter}` } });
    }
    if (req.method === 'POST' && url === '/api/v1/resources') {
      const body = JSON.parse(await readBody(req)) as { to?: string };
      resources.push({ uri: body.to ?? '', content: lastUpload });
      return sendJson(res, 200, { status: 'ok' });
    }
    if (req.method === 'POST' && url === '/api/v1/search/find') {
      const body = JSON.parse(await readBody(req)) as { query?: string; target_uri?: string };
      const target = body.target_uri ?? '';
      const query = body.query ?? '';
      const hits = resources
        .filter((r) => r.uri.startsWith(target))
        .map((r) => ({
          uri: r.uri,
          score: similarity(query, r.content),
          snippet: r.content.slice(0, 80),
        }))
        .filter((h) => h.score > 0.15)
        .sort((a, b) => b.score - a.score);
      return sendJson(res, 200, { result: { resources: hits } });
    }
    return sendJson(res, 404, { error: 'not found' });
  });
}

describe('联合 E2E 十三步（32 SPEC §7）', () => {
  let dir = '';
  let db: Database.Database;
  let modelStub: Stub;
  let memoryStub: Stub;
  let app: ReturnType<typeof buildApp>;
  let credentialRef = '';

  // 跨步骤共享的实体 ID
  let roomId = '';
  let roomRunId = '';
  let platformRunId = '';
  let artifactId = '';
  let decisionId = '';
  let issueId = '';

  type Method = 'GET' | 'POST' | 'DELETE';
  async function api<T>(
    method: Method,
    url: string,
    payload?: unknown,
  ): Promise<{ status: number; body: T }> {
    const res = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    return { status: res.statusCode, body: res.json() as T };
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wb-joint-e2e-'));
    modelStub = await startModelStub();
    memoryStub = await startMemoryStub();
    db = openConnection({ path: join(dir, 'e2e.db') });
    runMigrations(db, migrations);
    app = buildApp(db, {
      artifactsRoot: join(dir, 'artifacts'),
      credentialStore: new InMemoryCredentialStore(),
      // 主 Provider = 本地 OpenViking stub；不可用时由 InMemory 降级（真实降级链路）
      memoryProvider: new FallbackMemoryProvider(
        new OpenVikingAdapter({ baseUrl: memoryStub.url }),
        new InMemoryMemoryProvider(),
      ),
    });
    await app.ready();
  }, 60000);

  afterAll(async () => {
    await app.close();
    db.close();
    await modelStub.close();
    await memoryStub.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('1. 配置真实云 Provider credentialRef（只返回掩码）', async () => {
    const cred = await api<{ ref: string; masked: string }>('POST', '/api/v1/credentials', {
      ref: 'e2e-cloud-key',
      type: 'api_key',
      secret: 'sk-e2e-secret-value',
    });
    expect(cred.status).toBe(200);
    credentialRef = cred.body.ref;
    expect(credentialRef).toBe('e2e-cloud-key');
    expect(cred.body.masked).toBe('****alue');
    expect(JSON.stringify(cred.body)).not.toContain('sk-e2e-secret-value');

    const provider = await api<{ id: string }>('POST', '/api/v1/model-providers', {
      id: 'e2e-cloud',
      name: 'E2E 云 Provider',
      type: 'openai-compatible',
      baseUrl: modelStub.url,
      credentialRef,
    });
    expect(provider.status).toBe(200);
  }, 60000);

  it('2. Probe 与最小模型调用成功', async () => {
    const probe = await api<{ healthy: boolean; models: string[] }>(
      'POST',
      '/api/v1/model-providers/e2e-cloud/probe',
    );
    expect(probe.status).toBe(200);
    expect(probe.body.healthy).toBe(true);
    expect(probe.body.models).toContain('stub-designer');

    await api('POST', '/api/v1/model-profiles', {
      id: 'e2e-designer',
      name: '设计 Agent',
      providerId: 'e2e-cloud',
      modelId: 'stub-designer',
      capabilities: ['chat'],
      contextLimit: 32000,
      dataBoundary: 'local-only',
    });
    const chat = await api<{ content: string }>(
      'POST',
      '/api/v1/model-profiles/e2e-designer/chat',
      {
        messages: [{ role: 'user', content: '请生成 Spec' }],
        maxTokens: 512,
      },
    );
    expect(chat.status).toBe(200);
    expect(chat.body.content).toContain('Spec');
  }, 60000);

  it('3. 创建绑定项目的 SDD Delivery Room', async () => {
    const reg = await api<{ id: string }>('POST', '/api/v1/projects/register', {
      schemaVersion: 'workbench.project/v1',
      project: { id: PROJECT_ID, name: 'E2E 示例业务' },
      runtime: { root: 'tests/integration/fixtures/sample-job' },
      commands: [
        {
          id: 'lint',
          type: 'job',
          executable: 'node',
          arguments: ['-e', "console.log('lint ok')"],
          cwd: '${project.root}',
          timeoutSeconds: 60,
        },
      ],
    });
    expect(reg.status).toBe(200);

    const room = await api<{ id: string; status: string }>('POST', '/api/v1/rooms', {
      name: 'E2E SDD 交付室',
      roomType: 'sdd-delivery',
      manifest: { id: 'room_e2e', name: 'E2E SDD 交付室' },
    });
    expect(room.status).toBe(200);
    roomId = room.body.id;

    const bind = await api<{ projectId: string; access: { access: string } }>(
      'POST',
      `/api/v1/rooms/${roomId}/projects`,
      { projectId: PROJECT_ID, access: 'execute' },
    );
    expect(bind.status).toBe(200);
    expect(bind.body.access.access).toBe('execute');

    const listed = await api<{ items: { projectId: string }[]; total: number }>(
      'GET',
      `/api/v1/rooms/${roomId}/projects`,
    );
    expect(listed.body.items.some((p) => p.projectId === PROJECT_ID)).toBe(true);
  }, 60000);

  it('4. 设计 Agent 生成 Spec（真实 Provider 调用）', async () => {
    const run = await api<{ id: string; snapshot: { stage: string } }>(
      'POST',
      `/api/v1/rooms/${roomId}/sdd-runs`,
      {},
    );
    expect(run.status).toBe(200);
    expect(run.body.snapshot.stage).toBe('INTAKE');
    roomRunId = run.body.id;

    const spec = await api<{ content: string }>(
      'POST',
      '/api/v1/model-profiles/e2e-designer/chat',
      {
        messages: [{ role: 'user', content: '为 示例业务生成 Spec' }],
        maxTokens: 512,
      },
    );
    expect(spec.body.content).toContain('示例项目 Spec');

    // INTAKE → SPEC_DRAFT → SPEC_REVIEW → WAITING_SPEC_APPROVAL
    for (const expected of ['SPEC_DRAFT', 'SPEC_REVIEW', 'WAITING_SPEC_APPROVAL']) {
      const step = await api<{ stage: string }>(
        'POST',
        `/api/v1/room-runs/${roomRunId}/sdd-advance`,
        { specApproved: false, hasFinalArtifact: false },
      );
      expect(step.status).toBe(200);
      expect(step.body.stage).toBe(expected);
    }
  }, 60000);

  it('5. 人工批准（未批准被门禁拒绝，批准后通过）', async () => {
    const denied = await api<{ error: { code: string; message: string } }>(
      'POST',
      `/api/v1/room-runs/${roomRunId}/sdd-advance`,
      { specApproved: false, hasFinalArtifact: false },
    );
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe('ROOM_RUN_STATE_CONFLICT');
    expect(denied.body.error.message).toContain('未批准 Spec');

    const approved = await api<{ stage: string }>(
      'POST',
      `/api/v1/room-runs/${roomRunId}/sdd-advance`,
      { specApproved: true, hasFinalArtifact: false },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.stage).toBe('IMPLEMENTATION');
  }, 60000);

  it('6. Builder 经 Harness 实现（可替换 Agent 内核健康）', async () => {
    await api('POST', '/api/v1/harness-profiles', {
      id: 'e2e-harness',
      name: 'E2E Harness',
      adapterType: 'mock',
    });
    const probe = await api<{ id: string; adapterType: string; health: { ok: boolean } }>(
      'POST',
      '/api/v1/harness-profiles/e2e-harness/probe',
    );
    expect(probe.status).toBe(200);
    expect(probe.body.adapterType).toBe('mock');
    expect(probe.body.health.ok).toBe(true);
  }, 60000);

  it('7. 项目命令运行测试并形成 Run/Artifact（SHA-256 溯源）', async () => {
    const cmd = await api<{ runId: string; commandRef: string }>(
      'POST',
      `/api/v1/room-runs/${roomRunId}/commands`,
      {
        roomId,
        projectId: PROJECT_ID,
        commandId: 'lint',
        actorRef: 'builder-agent',
        allowedTools: ['lint'],
      },
    );
    expect(cmd.status).toBe(200);
    platformRunId = cmd.body.runId;
    expect(cmd.body.commandRef).toBe(`${PROJECT_ID}:lint`);

    const artifact = await api<{ id: string; sha256: string }>(
      'POST',
      `/api/v1/room-runs/${roomRunId}/artifacts`,
      {
        projectId: PROJECT_ID,
        runId: platformRunId,
        kind: 'test-report',
        logicalName: 'lint-report.md',
        content: Buffer.from('lint: ok\n', 'utf8').toString('base64'),
      },
    );
    expect(artifact.status).toBe(200);
    artifactId = artifact.body.id;
    expect(artifact.body.sha256).toMatch(/^[0-9a-f]{64}$/);

    // 事件事实源包含工具调用与证据附着
    const events = await api<{ items: { eventType: string }[] }>(
      'GET',
      `/api/v1/room-runs/${roomRunId}/events`,
    );
    const types = events.body.items.map((e) => e.eventType);
    expect(types).toContain('TOOL_CALL_REQUESTED');
    expect(types).toContain('EVIDENCE_ATTACHED');
  }, 60000);

  it('8. Reviewer/Judge 基于证据裁决（含利益冲突与证据 Gate）', async () => {
    const proposal = await api<{ payload: { id: string } }>(
      'POST',
      `/api/v1/room-runs/${roomRunId}/proposals`,
      {
        authorId: 'designer',
        title: '采纳 Spec',
        summary: '基于一致性验收标准',
        evidenceRefs: [artifactId],
      },
    );
    const proposalId = proposal.body.payload.id;

    await api('POST', `/api/v1/room-runs/${roomRunId}/critiques`, {
      proposalId,
      authorId: 'reviewer',
      dimension: 'consistency',
      comment: '边界条件需补充',
      evidenceRefs: [artifactId],
    });

    // 利益冲突：提案人不能给自己投票
    const conflict = await api<{ error: { code: string } }>(
      'POST',
      `/api/v1/room-runs/${roomRunId}/ballots`,
      {
        candidateId: proposalId,
        ballotterId: 'designer',
        proposalAuthorId: 'designer',
        dimensionScores: [{ dimension: 'consistency', score: 90, evidenceRefs: [artifactId] }],
      },
    );
    expect(conflict.status).toBe(422);
    expect(conflict.body.error.code).toBe('BALLOT_CONFLICT_OF_INTEREST');

    // 缺少证据引用：拒绝
    const noEvidence = await api<{ error: { code: string } }>(
      'POST',
      `/api/v1/room-runs/${roomRunId}/ballots`,
      {
        candidateId: proposalId,
        ballotterId: 'reviewer',
        proposalAuthorId: 'designer',
        dimensionScores: [{ dimension: 'consistency', score: 90, evidenceRefs: [] }],
      },
    );
    expect(noEvidence.status).toBe(422);
    expect(noEvidence.body.error.code).toBe('EVIDENCE_REQUIRED');

    await api('POST', `/api/v1/room-runs/${roomRunId}/ballots`, {
      candidateId: proposalId,
      ballotterId: 'reviewer',
      proposalAuthorId: 'designer',
      dimensionScores: [
        { dimension: 'consistency', score: 90, evidenceRefs: [artifactId] },
        { dimension: 'traceability', score: 80, evidenceRefs: [artifactId] },
      ],
    });

    const rubric = {
      dimensions: [
        { key: 'consistency', name: '一致性', weight: 60 },
        { key: 'traceability', name: '可追溯', weight: 40 },
      ],
    };
    const aggregate = await api<{ totalScore: number }[]>(
      'POST',
      `/api/v1/room-runs/${roomRunId}/aggregate`,
      { rubric, candidateIds: [proposalId] },
    );
    expect(aggregate.status).toBe(200);
    // 0.9*60 + 0.8*40 = 86
    expect(Math.round(aggregate.body[0]?.totalScore ?? 0)).toBe(86);

    const decision = await api<{ id: string; status: string }>(
      'POST',
      `/api/v1/room-runs/${roomRunId}/decisions`,
      {
        decisionType: 'spec-accept',
        winnerCandidateId: proposalId,
        result: { summary: '采纳' },
        evidenceRefs: [artifactId],
        requiredEvidence: [artifactId],
        gateChecks: { tests: 'pass', secrets: 'pass' },
      },
    );
    expect(decision.status).toBe(200);
    decisionId = decision.body.id;
    expect(decision.body.status).toBe('RECORDED');
  }, 60000);

  it('9. 失败与修复形成 Verified Lesson（Issue 四态 + 记忆晋升）', async () => {
    const created = await api<{ id: string; status: string }>('POST', '/api/v1/issues', {
      title: '采购与库存的数据不一致',
      description: '修复后通过一致性校验，教训：写入需在同一事务内校验',
    });
    expect(created.status).toBe(200);
    issueId = created.body.id;
    expect(created.body.status).toBe('OPEN');

    await api('POST', `/api/v1/issues/${issueId}/evidence`, {
      kind: 'run',
      uri: platformRunId,
    });

    const resolved = await api<{ status: string }>('POST', `/api/v1/issues/${issueId}/resolve`);
    expect(resolved.body.status).toBe('RESOLVED');

    const verified = await api<{ status: string }>('POST', `/api/v1/issues/${issueId}/verify`);
    expect(verified.body.status).toBe('VERIFIED');

    // OpenViking 在线时写入路径未接入 → 诚实失败（known-limitations #6），不静默成功
    const promoted = await api<{ error: { code: string } }>(
      'POST',
      `/api/v1/issues/${issueId}/promote-to-lesson`,
    );
    expect(promoted.status).toBe(503);
    expect(promoted.body.error.code).toBe('MEMORY_PROVIDER_UNAVAILABLE');

    const still = await api<{ status: string }>('GET', '/api/v1/issues');
    expect(still.body).toBeTruthy();
    const issue = (still.body as unknown as { items: { id: string; status: string }[] }).items.find(
      (i) => i.id === issueId,
    );
    expect(issue?.status).toBe('VERIFIED');
  }, 60000);

  it('10. 写入 OpenViking Candidate/Active Memory（只读资源导入）', async () => {
    const imported = await api<{ uri: string }>('POST', '/api/v1/memory/import', {
      projectId: PROJECT_ID,
      name: 'lesson-data-consistency',
      content:
        'Lesson：采购与库存的数据一致性由同一事务保证。Issue「采购与库存的数据不一致」修复后通过一致性校验。',
      sensitivity: 'internal',
    });
    expect(imported.status).toBe(200);
    expect(imported.body.uri).toBe(`project:${PROJECT_ID}:lesson-data-consistency`);

    const health = await api<{ status: string; ok: boolean }>('GET', '/api/v1/memory/health');
    expect(health.body.status).toBe('READY_READONLY');
    expect(health.body.ok).toBe(true);
  }, 60000);

  it('11. 新 Room 语义改写查询召回（且跨项目 0 召回）', async () => {
    // 另一个项目导入无关内容，验证项目隔离
    await api('POST', '/api/v1/memory/import', {
      projectId: OTHER_PROJECT_ID,
      name: 'unrelated-note',
      content: '本资源描述前端主题切换与设计令牌，与供应链数据无关。',
      sensitivity: 'internal',
    });

    const hit = await api<{ items: { uri: string; score: number }[]; total: number }>(
      'POST',
      '/api/v1/memory/search',
      { projectId: PROJECT_ID, query: '如何保证采购和库存的数据一致', limit: 5 },
    );
    expect(hit.status).toBe(200);
    expect(hit.body.total).toBeGreaterThan(0);
    expect(hit.body.items[0]?.uri).toBe(`project:${PROJECT_ID}:lesson-data-consistency`);
    expect(hit.body.items[0]?.score ?? 0).toBeGreaterThan(0.5);

    const crossProject = await api<{ items: { uri: string }[]; total: number }>(
      'POST',
      '/api/v1/memory/search',
      { projectId: OTHER_PROJECT_ID, query: '如何保证采购和库存的数据一致', limit: 5 },
    );
    expect(crossProject.body.total).toBe(0);
  }, 60000);

  it('12. 删除云凭据、停止 OpenViking/Adapter', async () => {
    const removed = await api<{ deleted: string }>(
      'DELETE',
      `/api/v1/credentials/${credentialRef}`,
    );
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toBe(credentialRef);

    const describe = await api<{ error: { code: string } }>(
      'GET',
      `/api/v1/credentials/${credentialRef}`,
    );
    expect(describe.status).toBe(404);
    expect(describe.body.error.code).toBe('CREDENTIAL_NOT_FOUND');

    // 删除凭据后，绑定该凭据的云端 Profile 调用失败（安全失败，不泄露 Secret）
    const chatAfter = await api<{ error: { code: string } }>(
      'POST',
      '/api/v1/model-profiles/e2e-designer/chat',
      { messages: [{ role: 'user', content: 'hi' }] },
    );
    expect(chatAfter.status).toBe(404);
    expect(chatAfter.body.error.code).toBe('CREDENTIAL_NOT_FOUND');

    // 停止 Sidecar（本地 stub 下线）
    await memoryStub.close();
  }, 60000);

  it('13. 验证安全失败和核心控制面降级可用', async () => {
    // Sidecar 下线 → Memory 自动降级（Fallback 标注 DEGRADED）
    const health = await api<{ status: string; ok: boolean; detail: string }>(
      'GET',
      '/api/v1/memory/health',
    );
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('DEGRADED');
    expect(health.body.ok).toBe(false);

    // 降级后 Lesson 晋升走本地实现 → 成功（对比步骤 9 的诚实失败）
    const promoted = await api<{ status: string }>(
      'POST',
      `/api/v1/issues/${issueId}/promote-to-lesson`,
    );
    expect(promoted.status).toBe(200);
    expect(promoted.body.status).toBe('LESSON');

    // 核心控制面仍可用
    const info = await api<{ name: string }>('GET', '/api/v1/app-info');
    expect(info.status).toBe(200);
    const runs = await api<{ items: unknown[] }>('GET', '/api/v1/runs');
    expect(runs.status).toBe(200);

    // 本地（无凭据）模型链路不受云凭据删除影响 → 降级可用
    await api('POST', '/api/v1/model-providers', {
      id: 'e2e-local',
      name: 'E2E 本地模型',
      type: 'ollama',
      baseUrl: modelStub.url,
    });
    await api('POST', '/api/v1/model-profiles', {
      id: 'e2e-local-profile',
      name: '本地降级 Profile',
      providerId: 'e2e-local',
      modelId: 'qwen-local',
      capabilities: ['chat'],
      contextLimit: 8192,
      dataBoundary: 'local-only',
    });
    const localChat = await api<{ content: string }>(
      'POST',
      '/api/v1/model-profiles/e2e-local-profile/chat',
      { messages: [{ role: 'user', content: '系统是否可用' }] },
    );
    expect(localChat.status).toBe(200);
    expect(localChat.body.content).toContain('本地模型降级可用');

    // 已记录的事实源未因降级丢失
    const decisions = await api<{ items: { id: string }[] }>(
      'GET',
      `/api/v1/room-runs/${roomRunId}/decisions`,
    );
    expect(decisions.body.items.some((d) => d.id === decisionId)).toBe(true);
  }, 60000);
});
