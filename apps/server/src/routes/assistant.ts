import type { FastifyInstance } from 'fastify';
import type { AssistantDraftInput } from '@workbench/contracts';
import type { AssistantDraftStore } from '@workbench/persistence';

/** Assistant 草稿 API（26 SPEC §10.1 L1 Assistant）：绑定到扩展草稿的 Prompt + 输入输出 Schema。 */
export function registerAssistantRoutes(app: FastifyInstance, store: AssistantDraftStore): void {
  app.get('/api/v1/extension-drafts/:id/assistant', async (request) => {
    const { id } = request.params as { id: string };
    return store.getByExtensionDraft(id) ?? null;
  });

  app.post('/api/v1/extension-drafts/:id/assistant', async (request) => {
    const { id } = request.params as { id: string };
    return store.upsert(id, request.body as AssistantDraftInput);
  });
}
