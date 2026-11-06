import type { FastifyInstance } from 'fastify';
import type { ModelUsageStore } from '@workbench/persistence';
import { ModelUsageService, type UsagePricing } from '../model-usage-service.js';

/** 模型使用量 API（P8-02）：记录 + 使用量/延迟/成本视图。 */
export function registerUsageRoutes(
  app: FastifyInstance,
  store: ModelUsageStore,
  pricing: Record<string, UsagePricing> = {},
): void {
  const service = new ModelUsageService(store, pricing);

  app.post('/api/v1/usage', async (request) => {
    const body = request.body as {
      modelProfileId?: string;
      modelId: string;
      promptTokens: number;
      completionTokens: number;
      latencyMs: number;
      cost?: number;
    };
    return service.record(body);
  });

  app.get('/api/v1/usage/overview', async () => {
    return service.overview();
  });

  app.get('/api/v1/usage/by-model', async () => {
    return service.byModel();
  });

  app.get('/api/v1/usage/by-day', async () => {
    return service.byDay();
  });
}
