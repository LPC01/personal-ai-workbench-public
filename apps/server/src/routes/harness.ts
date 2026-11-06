import type { FastifyInstance } from 'fastify';
import type { HarnessProfileInput } from '@workbench/contracts';
import { AppError } from '@workbench/domain';
import { createHarnessAdapter } from '@workbench/execution-gateway';
import type { HarnessProfileStore } from '@workbench/persistence';

/**
 * Harness Profiles API（26 SPEC §13 + 设计 §6.9）。
 * 平台通过 Execution Gateway 调用 DeepSeek Harness 或其他 Harness。
 */
export function registerHarnessRoutes(app: FastifyInstance, store: HarnessProfileStore): void {
  app.get('/api/v1/harness-profiles', async () => {
    const items = store.list();
    return { items, total: items.length };
  });

  app.post('/api/v1/harness-profiles', async (request) => {
    return store.upsert(request.body as HarnessProfileInput);
  });

  // 探测：实例化 Adapter 并检查 Harness 健康状态（不落库）。
  app.post('/api/v1/harness-profiles/:id/probe', async (request) => {
    const { id } = request.params as { id: string };
    const profile = store.get(id);
    if (!profile) {
      throw new AppError('HARNESS_PROFILE_NOT_FOUND', 'Harness Profile 不存在', {
        details: { id },
      });
    }
    const adapter = createHarnessAdapter(profile);
    const health = await adapter.health();
    return { id, adapterType: profile.adapterType, health };
  });
}
