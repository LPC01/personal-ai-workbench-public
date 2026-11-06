import type { FastifyInstance } from 'fastify';
import type { SddGateContext } from '@workbench/domain';
import type { SddService } from '../sdd-service.js';

/** SDD 开发交付 API（29 号 SPEC §14）。 */
export function registerSddRoutes(app: FastifyInstance, service: SddService): void {
  app.post('/api/v1/rooms/:roomId/sdd-runs', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const body = request.body as { topicId?: string };
    return service.createSddRun({ roomId, topicId: body?.topicId });
  });

  app.get('/api/v1/room-runs/:runId/sdd-stage', async (request) => {
    const { runId } = request.params as { runId: string };
    return { stage: service.getStage(runId) };
  });

  app.post('/api/v1/room-runs/:runId/sdd-advance', async (request) => {
    const { runId } = request.params as { runId: string };
    const ctx = request.body as SddGateContext;
    return service.advanceStage(runId, ctx);
  });
}
