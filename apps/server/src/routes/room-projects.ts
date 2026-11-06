import type { FastifyInstance } from 'fastify';
import type { ProjectService } from '../project-service.js';

/** 房间项目集成 API（29 号 SPEC §13）。 */
export function registerRoomProjectRoutes(app: FastifyInstance, service: ProjectService): void {
  app.post('/api/v1/rooms/:roomId/projects', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const body = request.body as { projectId: string; access: 'read' | 'execute' };
    return service.bindProject({ roomId, ...body });
  });

  app.get('/api/v1/rooms/:roomId/projects', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const items = service.listProjects(roomId);
    return { items, total: items.length };
  });

  app.post('/api/v1/room-runs/:runId/commands', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      roomId: string;
      projectId: string;
      commandId: string;
      actorRef: string;
      allowedTools: string[];
      args?: string[];
      requiresWrite?: boolean;
    };
    return service.executeCommand({ roomRunId: runId, ...body });
  });

  app.post('/api/v1/room-runs/:runId/artifacts', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      projectId: string;
      runId: string;
      kind: string;
      logicalName: string;
      content: string; // base64
      mediaType?: string;
    };
    return service.recordArtifact({
      roomRunId: runId,
      projectId: body.projectId,
      runId: body.runId,
      kind: body.kind,
      logicalName: body.logicalName,
      content: Buffer.from(body.content, 'base64'),
      mediaType: body.mediaType,
    });
  });
}
