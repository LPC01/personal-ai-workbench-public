import type { FastifyInstance } from 'fastify';
import type { DiagnosticsService } from '../diagnostics-service.js';

/** 诊断 API（P8-03）：一键健康检查。 */
export function registerDiagnosticsRoutes(app: FastifyInstance, service: DiagnosticsService): void {
  app.get('/api/v1/diagnostics', async () => {
    return service.run();
  });
}
