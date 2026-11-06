import { AppError } from '@workbench/domain';
import type { ToolPolicy } from '@workbench/contracts';
import {
  redactSecrets,
  type HarnessAdapter,
  type HarnessMessage,
  type HarnessToolRegistry,
  type HarnessToolScope,
} from '@workbench/execution-gateway';
import type {
  HarnessSessionRecord,
  HarnessSessionStore,
  RunRecord,
  RunStore,
} from '@workbench/persistence';
import type { RunStreamHub } from '@workbench/project-runtime';

/**
 * 执行网关（26 SPEC §13 + 设计 §6.9 + 29 SPEC §4）：
 * 把 Harness Adapter、工具注册表、Run 事件流、超时、取消与 Session 恢复串成闭环。
 *
 * - 一次 Agent Run 绑定一个 Harness Session（隔离上下文 + 游标）。
 * - 回合循环：adapter.run → 无工具则终态；有工具则经 ToolPolicy 白名单执行并回填，最多 MAX_TOOL_TURNS 轮。
 * - 事件（state/message/tool_call/tool_result）实时写入 Run 事件流（SSE）。
 * - 超时 → FAILED(TIMEOUT)；取消 → CANCELLING→CANCELLED（调用 adapter.cancel）。
 * - Session 恢复：按 contextCursor 重放 Run 事件。
 */

export interface StartAgentInput {
  sessionId?: string;
  projectId?: string;
  harnessProfileId: string;
  modelProfileId: string;
  agentProfileId?: string;
  toolPolicy: ToolPolicy;
  prompt: string;
}

export interface StartAgentResult {
  session: HarnessSessionRecord;
  run: RunRecord;
}

export interface ResumeResult {
  session: HarnessSessionRecord;
  run: RunRecord | undefined;
  events: { sequence: number; eventType: string; payload: Record<string, unknown> }[];
}

/** 最大工具回环轮数，防止失控。 */
const MAX_TOOL_TURNS = 16;

class HarnessTimeoutError extends Error {
  constructor() {
    super('Harness call timed out');
    this.name = 'HarnessTimeoutError';
  }
}

export class ExecutionGateway {
  private readonly cancelled = new Set<string>();

  constructor(
    private readonly adapter: HarnessAdapter,
    private readonly tools: HarnessToolRegistry,
    private readonly runStore: RunStore,
    private readonly sessionStore: HarnessSessionStore,
    private readonly hub: RunStreamHub,
  ) {}

  /** 创建 Agent Run + Harness Session 绑定（不可变快照）。 */
  async start(input: StartAgentInput): Promise<StartAgentResult> {
    const run = this.runStore.createRun({
      projectId: input.projectId,
      kind: 'agent',
      input: { prompt: input.prompt },
    });
    this.emit(run.id, 'state', { status: 'CREATED' });

    const session = this.sessionStore.create({
      id: input.sessionId,
      runId: run.id,
      harnessProfileId: input.harnessProfileId,
      modelProfileId: input.modelProfileId,
      agentProfileId: input.agentProfileId,
      toolPolicy: input.toolPolicy,
    });

    this.runStore.transitionRun(run.id, 'VALIDATING');
    this.runStore.transitionRun(run.id, 'QUEUED');
    this.runStore.transitionRun(run.id, 'STARTING');
    this.runStore.transitionRun(run.id, 'RUNNING');
    this.emit(run.id, 'state', { status: 'RUNNING' });
    this.sessionStore.updateStatus(session.id, 'running');

    return { session, run: this.requireRun(run.id) };
  }

  /** 执行一个 Agent 回合（含工具回环、超时、取消）。 */
  async runTurn(sessionId: string, prompt: string, timeoutSeconds = 120): Promise<RunRecord> {
    const session = this.requireSession(sessionId);
    const run = this.requireRun(session.runId);

    if (this.cancelled.has(sessionId)) {
      return this.finishCancelled(session, run);
    }

    // Harness 不可用降级：健康检查失败 → 优雅失败（不抛 500，不崩溃控制面）
    const health = await this.adapter.health().catch(() => ({ ok: false }));
    if (!health.ok) {
      this.runStore.transitionRun(run.id, 'FAILED', { errorCode: 'HARNESS_UNAVAILABLE' });
      this.sessionStore.updateStatus(sessionId, 'failed');
      this.emit(run.id, 'state', { status: 'FAILED', errorCode: 'HARNESS_UNAVAILABLE' });
      return this.requireRun(run.id);
    }

    const messages: HarnessMessage[] = [{ role: 'user', content: prompt }];

    try {
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        if (this.cancelled.has(sessionId)) {
          return this.finishCancelled(session, run);
        }

        const response = await this.withTimeout(
          this.adapter.run({
            sessionId,
            modelProfileId: session.modelProfileId,
            prompt,
            messages,
            tools: session.toolPolicy.allowedToolIds,
            toolPolicy: session.toolPolicy,
            timeoutSeconds,
          }),
          timeoutSeconds,
        );

        if (response.content) {
          this.emit(run.id, 'message', { role: 'assistant', content: response.content });
        }

        // 无工具调用 → 终态
        if (response.toolCalls.length === 0) {
          if (response.stopReason === 'cancelled') {
            return this.finishCancelled(session, run);
          }
          this.runStore.transitionRun(run.id, 'SUCCEEDED');
          this.sessionStore.updateStatus(sessionId, 'completed');
          this.emit(run.id, 'state', { status: 'SUCCEEDED' });
          return this.requireRun(run.id);
        }

        // 执行工具并回填结果（带作用域 + 参数脱敏）
        const scope: HarnessToolScope = { projectId: run.projectId, runId: run.id };
        const results: unknown[] = [];
        for (const toolCall of response.toolCalls) {
          this.emit(run.id, 'tool_call', {
            toolCallId: toolCall.id,
            toolId: toolCall.toolId,
            arguments: redactSecrets(toolCall.arguments),
          });
          const result = await this.tools.execute(
            { id: toolCall.id, toolId: toolCall.toolId, arguments: toolCall.arguments },
            session.toolPolicy,
            scope,
          );
          this.emit(run.id, 'tool_result', { ...result });
          results.push(result);
        }

        messages.push({ role: 'assistant', content: response.content || '' });
        messages.push({ role: 'tool', content: JSON.stringify(results) });
      }

      // 超过最大回合数
      this.runStore.transitionRun(run.id, 'FAILED', { errorCode: 'TOOL_TURN_LIMIT' });
      this.sessionStore.updateStatus(sessionId, 'failed');
      this.emit(run.id, 'state', { status: 'FAILED' });
    } catch (error) {
      if (this.cancelled.has(sessionId)) {
        return this.finishCancelled(session, run);
      }
      const errorCode = error instanceof HarnessTimeoutError ? 'TIMEOUT' : 'HARNESS_ERROR';
      this.runStore.transitionRun(run.id, 'FAILED', { errorCode });
      this.sessionStore.updateStatus(sessionId, 'failed');
      this.emit(run.id, 'state', { status: 'FAILED', errorCode });
    }

    return this.requireRun(run.id);
  }

  /** 取消：标记 + 调用 adapter.cancel + RUNNING→CANCELLING→CANCELLED。 */
  async cancel(sessionId: string): Promise<RunRecord> {
    const session = this.requireSession(sessionId);
    const run = this.requireRun(session.runId);
    this.cancelled.add(sessionId);
    await this.adapter.cancel(sessionId);
    const afterCancel = this.runStore.cancelRun(run.id);
    if (afterCancel.status === 'CANCELLING') {
      this.runStore.transitionRun(run.id, 'CANCELLED');
    }
    this.sessionStore.updateStatus(sessionId, 'cancelled');
    this.emit(run.id, 'state', { status: 'CANCELLED' });
    return this.requireRun(run.id);
  }

  /** Session 恢复：读取会话 + 游标之后的 Run 事件（用于断线/重启续传）。 */
  resume(sessionId: string): ResumeResult {
    const session = this.requireSession(sessionId);
    const run = session.runId ? this.runStore.getRun(session.runId) : undefined;
    const events = run ? this.runStore.listRunEventsAfter(run.id, session.contextCursor) : [];
    return { session, run, events };
  }

  private finishCancelled(session: HarnessSessionRecord, run: RunRecord): RunRecord {
    const after = this.runStore.cancelRun(run.id);
    if (after.status === 'CANCELLING') {
      this.runStore.transitionRun(run.id, 'CANCELLED');
    }
    this.sessionStore.updateStatus(session.id, 'cancelled');
    this.emit(run.id, 'state', { status: 'CANCELLED' });
    return this.requireRun(run.id);
  }

  private requireSession(sessionId: string): HarnessSessionRecord {
    const session = this.sessionStore.get(sessionId);
    if (!session) {
      throw new AppError('HARNESS_SESSION_NOT_FOUND', 'Harness Session 不存在', {
        details: { sessionId },
      });
    }
    return session;
  }

  private requireRun(runId: string | null): RunRecord {
    const run = runId ? this.runStore.getRun(runId) : undefined;
    if (!run) {
      throw new AppError('RUN_NOT_FOUND', 'Run 不存在', { details: { runId } });
    }
    return run;
  }

  private withTimeout<T>(promise: Promise<T>, seconds: number): Promise<T> {
    if (seconds <= 0) {
      return promise;
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new HarnessTimeoutError()), seconds * 1000);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private emit(runId: string, eventType: string, payload: Record<string, unknown>): void {
    const event = this.runStore.appendRunEvent(runId, eventType, payload);
    this.hub.publish(runId, event);
  }
}
