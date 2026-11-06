import type { FastifyInstance } from 'fastify';
import type { StudioStore } from '@workbench/persistence';
import { StudioService } from '../studio-service.js';

/** Studio API（26 SPEC §10.3）：会话 + 消息 + 需求→Spec。 */
export function registerStudioRoutes(app: FastifyInstance, store: StudioStore): void {
  const service = new StudioService(store);

  app.post('/api/v1/studio/sessions', async (request) => {
    const body = request.body as { title?: string };
    const title =
      typeof body?.title === 'string' && body.title.length > 0 ? body.title : '未命名会话';
    return store.createSession(title);
  });

  app.get('/api/v1/studio/sessions/:id/messages', async (request) => {
    const { id } = request.params as { id: string };
    const items = store.listMessages(id);
    return { items, total: items.length };
  });

  app.post('/api/v1/studio/sessions/:id/messages', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { role?: string; content?: string };
    const role = body?.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof body?.content === 'string' ? body.content : '';
    return store.addMessage(id, role, content);
  });

  app.post('/api/v1/studio/sessions/:id/generate-spec', async (request) => {
    const { id } = request.params as { id: string };
    return service.generateSpec(id);
  });
}
