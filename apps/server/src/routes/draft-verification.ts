import type { FastifyInstance } from 'fastify';
import type {
  AssistantDraftStore,
  DraftVerificationStore,
  StudioStore,
} from '@workbench/persistence';
import { DraftVerificationService } from '../draft-verification-service.js';
import { PermissionReviewService } from '../permission-review-service.js';

/** 草稿验证 API（26 SPEC §10.3）：build / test / eval + 预览 + 权限审阅。 */
export function registerDraftVerificationRoutes(
  app: FastifyInstance,
  studioStore: StudioStore,
  assistantStore: AssistantDraftStore,
  checks: DraftVerificationStore,
): void {
  const service = new DraftVerificationService(studioStore, assistantStore, checks);
  const reviewService = new PermissionReviewService(studioStore);

  app.post('/api/v1/extension-drafts/:id/build', async (request) => {
    const { id } = request.params as { id: string };
    return service.build(id);
  });

  app.post('/api/v1/extension-drafts/:id/test', async (request) => {
    const { id } = request.params as { id: string };
    return service.test(id);
  });

  app.post('/api/v1/extension-drafts/:id/eval', async (request) => {
    const { id } = request.params as { id: string };
    return service.eval(id);
  });

  app.get('/api/v1/extension-drafts/:id/preview', async (request) => {
    const { id } = request.params as { id: string };
    return service.preview(id);
  });

  app.get('/api/v1/extension-drafts/:id/permissions-review', async (request) => {
    const { id } = request.params as { id: string };
    return reviewService.review(id);
  });
}
