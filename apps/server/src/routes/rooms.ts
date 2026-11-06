import type { FastifyInstance } from 'fastify';
import { AppError } from '@workbench/domain';
import { RunStreamHub, toSseFrame } from '@workbench/project-runtime';
import type { RoomService } from '../room-service.js';

/** 聊天室 API（29 号 SPEC §11）：Room/Topic/Message/Run + 事件回放 + SSE。 */
export function registerRoomRoutes(
  app: FastifyInstance,
  service: RoomService,
  hub: RunStreamHub,
): void {
  const publishRunEvents = (runId: string): void => {
    for (const e of service.listEvents(runId)) {
      hub.publish(runId, {
        sequence: e.sequence,
        eventType: e.eventType,
        payload: e.payload,
        createdAt: e.createdAt,
      });
    }
  };

  app.get('/api/v1/rooms', async () => {
    const items = service.listRooms();
    return { items, total: items.length };
  });

  app.post('/api/v1/rooms', async (request) => {
    return service.createRoom(
      request.body as { name: string; roomType: string; manifest: Record<string, unknown> },
    );
  });

  app.get('/api/v1/rooms/:roomId', async (request) => {
    const { roomId } = request.params as { roomId: string };
    return service.getRoom(roomId);
  });

  app.post('/api/v1/rooms/:roomId/activate', async (request) => {
    const { roomId } = request.params as { roomId: string };
    return service.activate(roomId);
  });

  app.post('/api/v1/rooms/:roomId/archive', async (request) => {
    const { roomId } = request.params as { roomId: string };
    return service.archive(roomId);
  });

  app.post('/api/v1/rooms/:roomId/topics', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const { title } = request.body as { title: string };
    return service.createTopic({ roomId, title });
  });

  app.post('/api/v1/rooms/:roomId/runs', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const body = request.body as {
      topicId?: string;
      protocolId: string;
      protocolVersion: string;
      snapshot?: Record<string, unknown>;
      budget?: Record<string, unknown>;
    };
    const run = service.createRun({ roomId, ...body });
    // 实时推送 ROOM_RUN_CREATED
    for (const e of service.listEvents(run.id)) {
      hub.publish(run.id, {
        sequence: e.sequence,
        eventType: e.eventType,
        payload: e.payload,
        createdAt: e.createdAt,
      });
    }
    return run;
  });

  app.post('/api/v1/room-runs/:runId/messages', async (request) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as { actorRef: string; content: string };
    const ev = service.postMessage({
      roomRunId: runId,
      actorRef: body.actorRef,
      content: body.content,
    });
    hub.publish(runId, {
      sequence: ev.sequence,
      eventType: ev.eventType,
      payload: ev.payload,
      createdAt: ev.createdAt,
    });
    return ev;
  });

  app.get('/api/v1/room-runs/:runId', async (request) => {
    const { runId } = request.params as { runId: string };
    const run = service.getRun(runId);
    if (!run) {
      throw new AppError('ROOM_RUN_NOT_FOUND', 'RoomRun 不存在', { details: { runId } });
    }
    return run;
  });

  app.get('/api/v1/room-runs/:runId/events', async (request) => {
    const { runId } = request.params as { runId: string };
    const { after } = request.query as { after?: string };
    const afterSeq = Number(after ?? 0);
    const events =
      afterSeq > 0 ? service.listEventsAfter(runId, afterSeq) : service.listEvents(runId);
    return { items: events, total: events.length };
  });

  app.get('/api/v1/room-runs/:runId/work-items', async (request) => {
    const { runId } = request.params as { runId: string };
    return service.listWorkItems(runId);
  });

  app.post('/api/v1/room-runs/:runId/pause', async (request) => {
    const { runId } = request.params as { runId: string };
    const run = service.pause(runId);
    publishRunEvents(run.id);
    return run;
  });

  app.post('/api/v1/room-runs/:runId/resume', async (request) => {
    const { runId } = request.params as { runId: string };
    const run = service.resume(runId);
    publishRunEvents(run.id);
    return run;
  });

  app.post('/api/v1/room-runs/:runId/cancel', async (request) => {
    const { runId } = request.params as { runId: string };
    const run = service.cancel(runId);
    publishRunEvents(run.id);
    return run;
  });

  app.get('/api/v1/room-runs/:runId/stream', (request, reply) => {
    const { runId } = request.params as { runId: string };
    const lastEventId = Number(request.headers['last-event-id'] ?? 0);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // 先回放 last-event-id 之后的事件，再订阅实时推送
    for (const e of service.listEventsAfter(runId, lastEventId)) {
      reply.raw.write(
        toSseFrame({
          sequence: e.sequence,
          eventType: e.eventType,
          payload: e.payload,
          createdAt: e.createdAt,
        }),
      );
    }
    const unsub = hub.subscribe(runId, (ev) => {
      reply.raw.write(toSseFrame(ev));
    });
    reply.raw.on('close', () => unsub());
  });
}
