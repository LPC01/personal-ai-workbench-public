import type { FastifyInstance } from 'fastify';
import { AppError } from '@workbench/domain';
import type { ApprovalStore } from '@workbench/persistence';

/** 审批 API（人工裁决）：创建 + 列表 + 裁决（用于本地转云端等高风险操作的人工确认）。 */
export function registerApprovalRoutes(app: FastifyInstance, store: ApprovalStore): void {
  app.post('/api/v1/approvals', async (request) => {
    const body = request.body as {
      actionType?: string;
      targetRef?: string;
      request?: Record<string, unknown>;
    };
    if (!body.actionType || !body.targetRef) {
      throw new AppError('APPROVAL_REQUIRED', 'actionType 与 targetRef 必填', {
        details: { actionType: body.actionType, targetRef: body.targetRef },
      });
    }
    return store.create({
      actionType: body.actionType,
      targetRef: body.targetRef,
      request: body.request,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  });

  app.get('/api/v1/approvals', async () => {
    const items = store.list();
    return { items, total: items.length };
  });

  app.post('/api/v1/approvals/:id/decide', async (request) => {
    const { id } = request.params as { id: string };
    const { approved } = request.body as { approved: boolean };
    return store.decide(id, approved);
  });
}
