import type { FastifyInstance } from 'fastify';
import type { AgentProfileDefinition, AgentToolPolicy, ModelBinding } from '@workbench/contracts';
import type { AgentProfileService } from '../agent-profile-service.js';

/** AgentProfile 与 AgentSession API（29 号 SPEC §6/§7）。 */
export function registerAgentProfileRoutes(
  app: FastifyInstance,
  service: AgentProfileService,
): void {
  app.get('/api/v1/agent-profiles', async () => {
    const items = service.listProfiles();
    return { items, total: items.length };
  });

  app.post('/api/v1/agent-profiles', async (request) => {
    const { id, definition, status } = request.body as {
      id: string;
      definition: AgentProfileDefinition;
      status?: string;
    };
    return service.upsertProfile({ id, definition, status });
  });

  app.get('/api/v1/agent-profiles/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { revision } = request.query as { revision?: string };
    const rev = revision ? Number(revision) : undefined;
    return service.getProfile(id, Number.isNaN(rev) ? undefined : rev);
  });

  app.post('/api/v1/agent-sessions', async (request) => {
    const body = request.body as {
      roomRunId: string;
      participantId: string;
      agentProfileId: string;
      agentProfileRevision?: number;
      modelBinding: ModelBinding;
      toolPolicies: AgentToolPolicy[];
    };
    return service.createSession(body);
  });

  app.get('/api/v1/agent-sessions/:id', async (request) => {
    const { id } = request.params as { id: string };
    return service.getSession(id);
  });

  app.get('/api/v1/room-runs/:runId/sessions', async (request) => {
    const { runId } = request.params as { runId: string };
    const items = service.listSessions(runId);
    return { items, total: items.length };
  });
}
