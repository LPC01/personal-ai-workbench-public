import type { FastifyInstance } from 'fastify';
import type { DimensionScore, Rubric } from '@workbench/contracts';
import type { ReviewService } from '../review-service.js';

/** 评审决策 API（29 号 SPEC §15）。 */
export function registerReviewRoutes(app: FastifyInstance, service: ReviewService): void {
  app.post('/api/v1/room-runs/:runId/proposals', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      authorId: string;
      title: string;
      summary: string;
      evidenceRefs?: string[];
    };
    return service.submitProposal({ roomRunId: runId, ...body });
  });

  app.post('/api/v1/room-runs/:runId/critiques', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      proposalId: string;
      authorId: string;
      dimension: string;
      comment: string;
      evidenceRefs?: string[];
    };
    return service.submitCritique({ roomRunId: runId, ...body });
  });

  app.post('/api/v1/room-runs/:runId/ballots', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      candidateId: string;
      ballotterId: string;
      proposalAuthorId: string;
      dimensionScores: DimensionScore[];
    };
    return service.submitBallot({ roomRunId: runId, ...body });
  });

  app.post('/api/v1/room-runs/:runId/aggregate', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as { rubric: Rubric; candidateIds: string[] };
    return service.aggregate(runId, body.rubric, body.candidateIds);
  });

  app.post('/api/v1/room-runs/:runId/decisions', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as Parameters<ReviewService['recordDecision']>[0];
    return service.recordDecision({ ...body, roomRunId: runId });
  });

  app.get('/api/v1/room-runs/:runId/decisions', async (request) => {
    const { runId } = request.params as { runId: string };
    const items = service.listDecisions(runId);
    return { items, total: items.length };
  });
}
