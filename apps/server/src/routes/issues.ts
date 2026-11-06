import type { FastifyInstance } from 'fastify';
import type { IssueStore } from '@workbench/persistence';
import { IssueService } from '../issue-service.js';
import type { MemoryReviewService } from '@workbench/memory-gateway';

/** Issue API（25 设计 §6.11）：创建 / 证据 / 状态转换 / 晋升 Lesson。 */
export function registerIssueRoutes(
  app: FastifyInstance,
  store: IssueStore,
  memory?: MemoryReviewService,
): void {
  const service = new IssueService(store, memory);

  app.get('/api/v1/issues', async () => {
    const items = service.listIssues();
    return { items, total: items.length };
  });

  app.post('/api/v1/issues', async (request) => {
    const body = request.body as { title?: string; description?: string };
    return service.createIssue(body?.title ?? '未命名', body?.description ?? '');
  });

  app.post('/api/v1/issues/:id/evidence', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { kind?: string; uri?: string };
    return service.addEvidence(id, (body?.kind as 'run') ?? 'run', body?.uri ?? '');
  });

  app.get('/api/v1/issues/:id/evidence', async (request) => {
    const { id } = request.params as { id: string };
    const items = service.listEvidence(id);
    return { items, total: items.length };
  });

  app.post('/api/v1/issues/:id/resolve', async (request) => {
    const { id } = request.params as { id: string };
    return service.resolve(id);
  });

  app.post('/api/v1/issues/:id/verify', async (request) => {
    const { id } = request.params as { id: string };
    return service.verify(id);
  });

  app.post('/api/v1/issues/:id/promote-to-lesson', async (request) => {
    const { id } = request.params as { id: string };
    return service.promoteToLesson(id);
  });
}
