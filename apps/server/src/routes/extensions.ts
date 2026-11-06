import type { FastifyInstance } from 'fastify';
import type { ExtensionStore, StudioStore } from '@workbench/persistence';
import { ExtensionService } from '../extension-service.js';
import { ExtensionPublishService } from '../extension-publish-service.js';

/** 扩展生命周期 API（26 SPEC §10.3）：list / install / enable / rollback + publish-request。 */
export function registerExtensionRoutes(
  app: FastifyInstance,
  store: ExtensionStore,
  studioStore: StudioStore,
): void {
  const service = new ExtensionService(store);
  const publishService = new ExtensionPublishService(studioStore, store);

  app.get('/api/v1/extensions', async () => {
    const items = service.listExtensions();
    return { items, total: items.length };
  });

  app.post('/api/v1/extension-drafts/:id/publish-request', async (request) => {
    const { id } = request.params as { id: string };
    return publishService.publishRequest(id);
  });

  app.post('/api/v1/extensions/:id/versions/:version/install', async (request) => {
    const { id, version } = request.params as { id: string; version: string };
    return service.install(id, version);
  });

  app.post('/api/v1/extensions/:id/versions/:version/enable', async (request) => {
    const { id, version } = request.params as { id: string; version: string };
    return service.enable(id, version);
  });

  app.post('/api/v1/extensions/:id/rollback', async (request) => {
    const { id } = request.params as { id: string };
    return service.rollback(id);
  });
}
