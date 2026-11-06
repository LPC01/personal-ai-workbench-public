import type { FastifyInstance } from 'fastify';
import { AppError, isTerminalRunStatus } from '@workbench/domain';
import type { RunStore } from '@workbench/persistence';
import { toSseFrame, type RunStreamEvent, type RunStreamHub } from '@workbench/project-runtime';
import type { JobRunner } from '../job-runner.js';

/** Runs API（26 SPEC §10.2）：事件列表 + SSE 流式（含断线重连）。 */
export function registerRunRoutes(
  app: FastifyInstance,
  runStore: RunStore,
  hub: RunStreamHub,
  jobRunner: JobRunner,
): void {
  // 运行列表（§10.2 GET /runs）
  app.get('/api/v1/runs', async () => {
    const items = runStore.listRuns();
    return { items, total: items.length };
  });

  // 运行详情（§10.2 GET /runs/{runId}）
  app.get('/api/v1/runs/:runId', async (request) => {
    const { runId } = request.params as { runId: string };
    const run = runStore.getRun(runId);
    if (!run) {
      throw new AppError('RUN_NOT_FOUND', 'Run 不存在', { details: { runId } });
    }
    return run;
  });

  // 事件列表（支持 ?after=<sequence> 增量拉取，用于非 SSE 的断线补偿）
  app.get('/api/v1/runs/:runId/events', async (request) => {
    const { runId } = request.params as { runId: string };
    if (!runStore.getRun(runId)) {
      throw new AppError('RUN_NOT_FOUND', 'Run 不存在', { details: { runId } });
    }
    const after = Number((request.query as { after?: string }).after ?? 0) || 0;
    const events =
      after > 0 ? runStore.listRunEventsAfter(runId, after) : runStore.listRunEvents(runId);
    return { runId, items: events, total: events.length };
  });

  // 取消 Run（§10.2）：经 JobRunner 取消（杀进程树），非 job Run 退化为状态迁移
  app.post('/api/v1/runs/:runId/cancel', async (request) => {
    const { runId } = request.params as { runId: string };
    return jobRunner.cancel(runId);
  });

  // SSE 流：Last-Event-ID 断线重连回放 + 实时订阅（先订阅后回放，去重保证顺序）
  app.get('/api/v1/runs/:runId/stream', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const run = runStore.getRun(runId);
    if (!run) {
      throw new AppError('RUN_NOT_FOUND', 'Run 不存在', { details: { runId } });
    }

    const lastEventId = Number((request.headers['last-event-id'] as string | undefined) ?? 0) || 0;

    let lastSequence = lastEventId;
    let replaying = true;
    const pending: RunStreamEvent[] = [];

    // 先订阅，避免回放期间漏掉并发事件
    const unsubscribe = hub.subscribe(runId, (event) => {
      if (replaying) {
        pending.push(event);
      } else if (event.sequence > lastSequence) {
        lastSequence = event.sequence;
        reply.raw.write(toSseFrame(event));
      }
    });

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // 回放历史事件
    for (const event of runStore.listRunEventsAfter(runId, lastEventId)) {
      lastSequence = event.sequence;
      reply.raw.write(toSseFrame(event));
    }

    // 终态：回放完即关闭；非终态：排空回放期间缓冲的事件并保持订阅
    if (isTerminalRunStatus(run.status)) {
      unsubscribe();
      reply.raw.end();
      return;
    }

    replaying = false;
    for (const event of pending) {
      if (event.sequence > lastSequence) {
        lastSequence = event.sequence;
        reply.raw.write(toSseFrame(event));
      }
    }
    pending.length = 0;

    request.raw.on('close', () => {
      unsubscribe();
    });
  });
}
