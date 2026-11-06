import type { FastifyInstance } from 'fastify';
import { AppError } from '@workbench/domain';
import { isHarnessTool, type HarnessToolId, type ToolPolicy } from '@workbench/contracts';
import type { AgentRunService } from '../agent-run-service.js';

/**
 * Agent Run API（26 SPEC §13 + §10.2 Run 语义）。
 *
 * 事件流不在此处重复实现：Run 的事件与 SSE 复用既有
 * `GET /api/v1/runs/{runId}/events` 与 `GET /api/v1/runs/{runId}/stream`。
 *
 * 说明：26 §10.3 未定义 agent 执行端点，本命名属实现决策；`/agent-sessions` 已被
 * 房间 AgentSession（`routes/agent-profiles.ts`）占用，故另立 `/agent-runs`。
 */

interface StartBody {
  harnessProfileId?: unknown;
  modelProfileId?: unknown;
  agentProfileId?: unknown;
  projectId?: unknown;
  sessionId?: unknown;
  toolPolicy?: unknown;
  prompt?: unknown;
}

function requireString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError('COMMAND_ARGUMENT_INVALID', `缺少参数 ${key}`, { details: { key } });
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** 解析并校验工具策略：缺省为空白名单（最安全），非法工具 ID 直接拒绝。 */
function parseToolPolicy(value: unknown): ToolPolicy {
  if (value === undefined || value === null) {
    return { allowedToolIds: [], constraints: {} };
  }
  if (typeof value !== 'object') {
    throw new AppError('COMMAND_ARGUMENT_INVALID', 'toolPolicy 需为对象', {
      details: { key: 'toolPolicy' },
    });
  }
  const raw = value as { allowedToolIds?: unknown; constraints?: unknown };
  const ids = raw.allowedToolIds ?? [];
  if (!Array.isArray(ids)) {
    throw new AppError('COMMAND_ARGUMENT_INVALID', 'toolPolicy.allowedToolIds 需为数组', {
      details: { key: 'allowedToolIds' },
    });
  }
  const allowedToolIds: HarnessToolId[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !isHarnessTool(id)) {
      throw new AppError('COMMAND_ARGUMENT_INVALID', `非法的工具 ID：${String(id)}`, {
        details: { toolId: id },
      });
    }
    allowedToolIds.push(id);
  }
  const constraints = (raw.constraints ?? {}) as Record<string, unknown>;
  return { allowedToolIds, constraints };
}

export function registerAgentRunRoutes(app: FastifyInstance, service: AgentRunService): void {
  // 发起 Agent Run：创建平台 Run（kind=agent）+ Harness Session 绑定
  app.post('/api/v1/agent-runs', async (request) => {
    const body = (request.body ?? {}) as StartBody;
    return service.start({
      harnessProfileId: requireString(body.harnessProfileId, 'harnessProfileId'),
      modelProfileId: requireString(body.modelProfileId, 'modelProfileId'),
      prompt: requireString(body.prompt, 'prompt'),
      sessionId: optionalString(body.sessionId),
      projectId: optionalString(body.projectId),
      agentProfileId: optionalString(body.agentProfileId),
      toolPolicy: parseToolPolicy(body.toolPolicy),
    });
  });

  // 执行一个回合（含工具回环、超时、取消）
  app.post('/api/v1/agent-runs/:sessionId/turns', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = (request.body ?? {}) as { prompt?: unknown; timeoutSeconds?: unknown };
    const prompt = requireString(body.prompt, 'prompt');
    const timeoutSeconds =
      typeof body.timeoutSeconds === 'number' ? body.timeoutSeconds : undefined;
    const run = await service.turn(sessionId, prompt, timeoutSeconds);
    return { run };
  });

  // 取消：标记 + 调用 adapter.cancel + RUNNING→CANCELLING→CANCELLED
  app.post('/api/v1/agent-runs/:sessionId/cancel', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const run = await service.cancel(sessionId);
    return { run };
  });

  // 会话恢复：返回会话 + 游标之后的 Run 事件（断线 / 重启续传）
  app.get('/api/v1/agent-runs/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return service.resume(sessionId);
  });
}
