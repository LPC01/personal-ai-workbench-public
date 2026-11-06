import type { FastifyInstance } from 'fastify';
import type { CandidateSource } from '@workbench/domain';
import type { MemoryRefinementService } from '../memory-refinement-service.js';

/** 记忆提炼 API（29 号 SPEC §17）。 */
export function registerRefinementRoutes(
  app: FastifyInstance,
  service: MemoryRefinementService,
): void {
  app.post('/api/v1/room-runs/:runId/memory-candidates', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as { content: string; source: CandidateSource };
    return service.refineToCandidate({ roomRunId: runId, ...body });
  });
}
