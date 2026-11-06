import type { FastifyInstance } from 'fastify';
import type { ArtifactStore, RunStore } from '@workbench/persistence';
import type { ProjectCatalog } from '@workbench/project-runtime';
import { OverviewService } from '../overview-service.js';

/** 概览 API（P8-01）：全局搜索 / 摘要 / 时间线。 */
export function registerOverviewRoutes(
  app: FastifyInstance,
  catalog: ProjectCatalog,
  runStore: RunStore,
  artifactStore: ArtifactStore,
): void {
  const service = new OverviewService(catalog, runStore, artifactStore);

  app.get('/api/v1/overview/summary', async () => {
    return service.summary();
  });

  app.get('/api/v1/overview/timeline', async (request) => {
    const { limit } = request.query as { limit?: string };
    return service.timeline(Number(limit) || 50);
  });

  app.get('/api/v1/overview/search', async (request) => {
    const { q } = request.query as { q?: string };
    return service.search(q ?? '');
  });
}
