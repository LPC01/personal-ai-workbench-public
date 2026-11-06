import type { FastifyInstance } from 'fastify';
import type {
  MemoryCenterPort,
  MemoryCenterStatus,
  MemoryProvider,
  MemoryScope,
} from '@workbench/contracts';
import type {
  MemoryRecallService,
  MemoryReviewService,
  MemoryService,
} from '@workbench/memory-gateway';

export interface MemoryRoutesDeps {
  service: MemoryService;
  provider: MemoryProvider;
  review: MemoryReviewService;
  recall: MemoryRecallService;
  center: MemoryCenterPort;
}

const STATUSES: readonly MemoryCenterStatus[] = [
  'CANDIDATE',
  'VERIFIED',
  'ACTIVE',
  'SUPERSEDED',
  'REVOKED',
];

function parseStatuses(raw: unknown): MemoryCenterStatus[] | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const parts = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is MemoryCenterStatus => (STATUSES as readonly string[]).includes(s));
  return parts.length > 0 ? parts : undefined;
}

/**
 * 记忆 API（26 SPEC §14.2 + 32 SPEC §4.5 + 25 设计「记忆中心」子树）。
 * - 健康 / 只读导入 / 项目范围语义检索（既有）
 * - 候选审核（Candidate Inbox）：propose / list / verify / activate / supersede / revoke
 * - 全量 Resources 列表（工作台侧投影）
 * - 检索与召回：`POST /memory/recall` 执行预算裁剪召回并落一条审计；`GET /memory/recall-audit` 列出
 */
export function registerMemoryRoutes(app: FastifyInstance, deps: MemoryRoutesDeps): void {
  const { service, provider, review, recall, center } = deps;

  app.get('/api/v1/memory/health', async () => provider.health());

  app.post('/api/v1/memory/import', async (request) => {
    const body = request.body as {
      projectId: string;
      name: string;
      content: string;
      sensitivity?: 'public' | 'internal' | 'confidential';
      sourceRefs?: string[];
    };
    return service.importReadOnlyResource(body.projectId, body.name, body.content, {
      sensitivity: body.sensitivity,
      sourceRefs: body.sourceRefs,
    });
  });

  /** 全量 Resources 列表（按项目隔离）。 */
  app.get('/api/v1/memory/resources', async (request) => {
    const { projectId } = request.query as { projectId?: string };
    const items = service.listResources(projectId);
    return { items, total: items.length };
  });

  app.post('/api/v1/memory/search', async (request) => {
    const body = request.body as { projectId: string; query: string; limit?: number };
    const items = await service.searchProject(body.projectId, body.query, body.limit ?? 10);
    return { items, total: items.length };
  });

  /** 候选收件箱（Candidate Inbox / Superseded）：按项目与状态过滤。 */
  app.get('/api/v1/memory/candidates', async (request) => {
    const { projectId, status } = request.query as { projectId?: string; status?: string };
    const items = review.listCandidates({ projectId, statuses: parseStatuses(status) });
    return { items, total: items.length };
  });

  /** 提议候选（模型产物只能进入 CANDIDATE；Secret/PII 守卫在服务内）。 */
  app.post('/api/v1/memory/candidates', async (request) => {
    const body = request.body as {
      content: string;
      scope?: MemoryScope;
      projectId?: string;
      sourceUri?: string;
    };
    const ref = await review.propose(body.content, body.scope ?? 'project', {
      projectId: body.projectId,
      sourceUri: body.sourceUri,
    });
    return { ref, status: review.status(ref) };
  });

  app.post('/api/v1/memory/candidates/:uri/verify', async (request) => {
    const { uri } = request.params as { uri: string };
    review.verify({ uri });
    return { uri, status: review.status({ uri }) };
  });

  app.post('/api/v1/memory/candidates/:uri/activate', async (request) => {
    const { uri } = request.params as { uri: string };
    await review.activate({ uri });
    return { uri, status: review.status({ uri }) };
  });

  app.post('/api/v1/memory/candidates/:uri/supersede', async (request) => {
    const { uri } = request.params as { uri: string };
    const body = (request.body ?? {}) as { supersededBy?: string };
    review.supersede({ uri }, body.supersededBy ? { uri: body.supersededBy } : undefined);
    return { uri, status: review.status({ uri }) };
  });

  app.post('/api/v1/memory/candidates/:uri/revoke', async (request) => {
    const { uri } = request.params as { uri: string };
    await review.revoke({ uri });
    return { uri, status: review.status({ uri }) };
  });

  /** 执行带预算的召回，并落一条审计记录。 */
  app.post('/api/v1/memory/recall', async (request) => {
    const body = request.body as {
      projectId: string;
      query: string;
      scope?: MemoryScope;
      budgetTokens?: number;
    };
    const result = await recall.recall(
      body.query,
      body.scope ?? 'project',
      body.budgetTokens ?? 2048,
      {
        projectId: body.projectId,
      },
    );
    return { hits: result.hits, total: result.hits.length, record: result.record };
  });

  /** 检索与召回审计列表。 */
  app.get('/api/v1/memory/recall-audit', async (request) => {
    const { projectId, limit } = request.query as { projectId?: string; limit?: string };
    const parsed = limit !== undefined ? Number.parseInt(limit, 10) : undefined;
    const items = center.listRecallAudits({
      projectId,
      limit: Number.isFinite(parsed) ? parsed : undefined,
    });
    return { items, total: items.length };
  });
}
