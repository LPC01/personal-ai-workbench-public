import { AppError } from '@workbench/domain';
import type { ToolPolicy } from '@workbench/contracts';
import { createHarnessAdapter, type HarnessToolRegistry } from '@workbench/execution-gateway';
import type {
  HarnessProfileStore,
  HarnessSessionStore,
  RunRecord,
  RunStore,
} from '@workbench/persistence';
import type { RunStreamHub } from '@workbench/project-runtime';
import { ExecutionGateway, type ResumeResult, type StartAgentResult } from './execution-gateway.js';

/**
 * Agent Run 服务（26 SPEC §13）：把「平台 Run ↔ Harness Profile ↔ 执行网关闭环」接起来。
 *
 * 关键设计：**按 `harnessProfileId` 缓存 `ExecutionGateway`**。
 * `ExecutionGateway` 在构造时绑定 adapter 实例，而取消语义依赖实例内的取消集合
 * （`MockHarnessAdapter` 等有状态 adapter 亦然）；若每次请求新建 gateway，会丢失该状态。
 * 故以 profile 为键复用 gateway，并在 profile 修订号变化时重建。
 */

export interface StartAgentRunInput {
  sessionId?: string;
  projectId?: string;
  harnessProfileId: string;
  modelProfileId: string;
  agentProfileId?: string;
  toolPolicy: ToolPolicy;
  prompt: string;
}

export class AgentRunService {
  private readonly gateways = new Map<string, ExecutionGateway>();
  private readonly revisions = new Map<string, number>();

  constructor(
    private readonly profileStore: HarnessProfileStore,
    private readonly tools: HarnessToolRegistry,
    private readonly runStore: RunStore,
    private readonly sessionStore: HarnessSessionStore,
    private readonly hub: RunStreamHub,
  ) {}

  /** 创建 Agent Run + Harness Session（adapter 由 profile 解析）。 */
  start(input: StartAgentRunInput): Promise<StartAgentResult> {
    return this.gatewayFor(input.harnessProfileId).start(input);
  }

  /** 执行一个回合（按 Session 反查其 harnessProfileId 定位 gateway）。 */
  turn(sessionId: string, prompt: string, timeoutSeconds?: number): Promise<RunRecord> {
    return this.gatewayForSession(sessionId).runTurn(sessionId, prompt, timeoutSeconds);
  }

  cancel(sessionId: string): Promise<RunRecord> {
    return this.gatewayForSession(sessionId).cancel(sessionId);
  }

  resume(sessionId: string): ResumeResult {
    return this.gatewayForSession(sessionId).resume(sessionId);
  }

  private gatewayForSession(sessionId: string): ExecutionGateway {
    const session = this.sessionStore.get(sessionId);
    if (!session) {
      throw new AppError('HARNESS_SESSION_NOT_FOUND', 'Harness Session 不存在', {
        details: { sessionId },
      });
    }
    return this.gatewayFor(session.harnessProfileId);
  }

  private gatewayFor(harnessProfileId: string): ExecutionGateway {
    const profile = this.profileStore.get(harnessProfileId);
    if (!profile) {
      throw new AppError('HARNESS_PROFILE_NOT_FOUND', 'Harness Profile 不存在', {
        details: { harnessProfileId },
      });
    }
    const cached = this.gateways.get(profile.id);
    if (cached && this.revisions.get(profile.id) === profile.revision) {
      return cached;
    }
    const gateway = new ExecutionGateway(
      createHarnessAdapter(profile),
      this.tools,
      this.runStore,
      this.sessionStore,
      this.hub,
    );
    this.gateways.set(profile.id, gateway);
    this.revisions.set(profile.id, profile.revision);
    return gateway;
  }
}
