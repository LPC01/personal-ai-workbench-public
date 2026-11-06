import { randomUUID } from 'node:crypto';
import { AppError } from '@workbench/domain';
import {
  isHarnessTool,
  type HarnessToolId,
  type RoomEvent,
  type RoomRun,
} from '@workbench/contracts';
import type { RoomOrchestrator } from '@workbench/room-orchestrator';
import type { HarnessSessionStore, RoomStore, RunStore } from '@workbench/persistence';
import type { RunStreamHub } from '@workbench/project-runtime';
import type { AgentRunService } from './agent-run-service.js';

/**
 * 参与者规格（编排启动时的外部形态）。
 *
 * 与 `@workbench/room-orchestrator` 的 `ParticipantSpec` 的差别：本结构额外携带
 * `harnessProfileId` —— 自动轮次需要拿它建立 Harness Session（真实模型调用的执行载体）。
 * 该字段最终被折叠进 `agentProfileSnapshot`（29 SPEC §7.1「不可变快照」）持久化，
 * **不新增列、不新增表**：快照本来就是自由结构，参与者上下文属于快照语义。
 */
export interface RoomParticipantInput {
  participantId: string;
  agentProfileId?: string;
  harnessProfileId?: string;
  modelBinding: { modelProfileId: string; providerId?: string; revision?: number };
  toolPolicy: { allowedTools: string[]; deniedTools?: string[] };
  /** 角色设定（写进提示词首行，也进快照）。 */
  systemInstruction?: string;
  agentProfileSnapshot?: Record<string, unknown>;
}

/**
 * 把参与者规格折叠为不可变快照（含 Harness Session 绑定与发言次序）。
 *
 * `order` 用于让轮询次序与「登记时的配置顺序」一致且可重现——
 * `agent_sessions` 只按 `created_at` 排序，同毫秒创建的会话次序在 SQLite 下不稳定。
 */
export function buildParticipantSnapshot(
  input: RoomParticipantInput,
  binding: { harnessSessionId?: string; platformRunId?: string } = {},
  order = 0,
): Record<string, unknown> {
  return {
    ...(input.agentProfileSnapshot ?? {}),
    agentProfileId: input.agentProfileId ?? null,
    harnessProfileId: input.harnessProfileId ?? null,
    harnessSessionId: binding.harnessSessionId ?? null,
    platformRunId: binding.platformRunId ?? null,
    systemInstruction: input.systemInstruction ?? null,
    order,
  };
}

/** 发言次序：先按配置顺序 `order`，再按 participantId 兜底（保证可重现）。 */
export function sortParticipants<
  T extends { participantId: string; agentProfileSnapshot: Record<string, unknown> },
>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    const ao = typeof a.agentProfileSnapshot?.order === 'number' ? a.agentProfileSnapshot.order : 0;
    const bo = typeof b.agentProfileSnapshot?.order === 'number' ? b.agentProfileSnapshot.order : 0;
    if (ao !== bo) return ao - bo;
    return a.participantId.localeCompare(b.participantId);
  });
}

/** 为参与者建立 Harness Session（无 harnessProfileId 时跳过：纯人工派发模式）。 */
export async function bindHarnessSession(
  agentRunService: AgentRunService | undefined,
  input: RoomParticipantInput,
  opts: { sessionId?: string; projectId?: string } = {},
): Promise<{ harnessSessionId?: string; platformRunId?: string }> {
  if (!agentRunService || !input.harnessProfileId) return {};

  // 工具白名单：29 SPEC §19 权限为交集，非 Harness 工具一律拒绝（不静默降级）
  const allowedToolIds: HarnessToolId[] = [];
  for (const id of input.toolPolicy.allowedTools) {
    if (!isHarnessTool(id)) {
      throw new AppError('COMMAND_ARGUMENT_INVALID', `非法的工具 ID：${String(id)}`, {
        details: { participantId: input.participantId, toolId: String(id) },
      });
    }
    allowedToolIds.push(id);
  }

  const result = await agentRunService.start({
    sessionId: opts.sessionId ?? `hses_${randomUUID()}`,
    projectId: opts.projectId,
    harnessProfileId: input.harnessProfileId,
    modelProfileId: input.modelBinding.modelProfileId,
    agentProfileId: input.agentProfileId,
    toolPolicy: {
      allowedToolIds,
      constraints: input.toolPolicy.deniedTools
        ? { deniedTools: input.toolPolicy.deniedTools }
        : {},
    },
    // 起始提示词只用于固定会话上下文；首轮真正的内容由 auto-turn 组装后传入
    prompt: input.systemInstruction?.trim() || `你是协作参与者 ${input.participantId}。`,
  });
  return { harnessSessionId: result.session.id, platformRunId: result.run.id };
}

export interface AutoTurnInput {
  roomRunId: string;
  /** 用户本轮输入；非空时先写 USER_MESSAGE 再从 Agent 侧推进。 */
  content?: string;
  /** 指定首个发言人（人工指定优先于轮询）。 */
  participantId?: string;
  /** 连续推进几轮（默认 1，上限为参与者数）。 */
  rounds?: number;
  timeoutSeconds?: number;
}

export interface AutoTurnRecord {
  participantId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  content: string;
  tokens: number;
  platformRunId: string | null;
  errorCode?: string;
}

export interface AutoTurnResult {
  run: RoomRun;
  turns: AutoTurnRecord[];
  /** 提前停止的原因（预算超限 / Harness 不可用 / 未绑定会话 …）。 */
  stoppedReason: string | null;
}

/** 无 tokenizer 时的诚实估算：4 字符 ≈ 1 token（UI 与文档均标注为估算）。 */
export function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

/** 取某平台 Run 中最后一条 assistant 消息（Harness 侧真源）。 */
function lastAssistantMessage(
  events: { eventType: string; payload: Record<string, unknown> }[],
): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e && e.eventType === 'message' && e.payload.role === 'assistant') {
      const content = e.payload.content;
      if (typeof content === 'string' && content.trim().length > 0) return content;
    }
  }
  return '';
}

/** 组装本轮提示词：角色设定 + 最近若干轮对话（不含工具/系统噪声）。 */
function buildPrompt(input: {
  participantId: string;
  systemInstruction: string | null;
  transcript: { actorRef: string; content: string }[];
}): string {
  const lines = [
    `你是协作聊天室中的参与者「${input.participantId}」。`,
    input.systemInstruction ? `角色设定：${input.systemInstruction}` : null,
    '以下是本次协作的最近记录（按时间顺序）：',
    ...input.transcript.map((t) => `- ${t.actorRef}: ${t.content}`),
    '请基于上述上下文，给出你这一轮的产出（简洁、可执行、不要复述已说过的内容）。',
  ].filter((l): l is string => typeof l === 'string');
  return lines.join('\n');
}

/**
 * 聊天室自动轮次服务（补齐 known-limitations 中「编排已具备、无人驱动」的缺口）。
 *
 * 语义：一次调用 = 推进 `rounds` 个参与者发言（默认 1，轮询，可人工指定首个发言人）。
 * 每轮做三件事：① 定位参与者的 Harness Session；② 调真实模型（含工具回环）取回内容；
 * ③ 交回 `RoomOrchestrator.dispatchTurn` 走既有的候选/预算/状态门禁。
 * 模型调用失败时**不伪造内容**——记录 FAILED 并如实停止。
 */
export class RoomAutoTurnService {
  constructor(
    private readonly orchestrator: RoomOrchestrator,
    private readonly roomStore: RoomStore,
    private readonly runStore: RunStore,
    private readonly sessionStore: HarnessSessionStore,
    /** 公开给路由层复用（启动时为每个参与者建立 Harness Session）。 */
    readonly agentRunService: AgentRunService | undefined,
    private readonly hub?: RunStreamHub,
  ) {}

  async run(input: AutoTurnInput): Promise<AutoTurnResult> {
    const roomRunId = input.roomRunId;
    const run = this.roomStore.getRun(roomRunId);
    if (!run) {
      throw new AppError('ROOM_RUN_NOT_FOUND', 'RoomRun 不存在', { details: { roomRunId } });
    }
    if (run.status !== 'RUNNING' && run.status !== 'WAITING_AGENT') {
      throw new AppError('ROOM_RUN_STATE_CONFLICT', `RoomRun 状态 ${run.status} 不接受自动轮次`, {
        details: { roomRunId, status: run.status },
      });
    }

    const sessions = sortParticipants(this.orchestrator.listSessions(roomRunId));
    if (sessions.length === 0) {
      throw new AppError('PARTICIPANT_NOT_ALLOWED', '编排尚未启动或没有参与者，无法自动推进', {
        details: { roomRunId },
      });
    }
    const allowed = sessions.map((s) => s.participantId);

    if (input.content && input.content.trim().length > 0) {
      this.roomStore.appendEvent({
        roomRunId,
        eventType: 'USER_MESSAGE',
        actorRef: 'user',
        payload: { content: input.content },
      });
    }

    const turns: AutoTurnRecord[] = [];
    let stoppedReason: string | null = null;
    const rounds = Math.min(Math.max(1, Math.trunc(input.rounds ?? 1)), sessions.length);
    let speaker = input.participantId ?? this.nextSpeaker(roomRunId, allowed);

    for (let i = 0; i < rounds; i += 1) {
      const session = sessions.find((s) => s.participantId === speaker);
      if (!session) {
        turns.push({
          participantId: speaker ?? '',
          status: 'SKIPPED',
          content: '',
          tokens: 0,
          platformRunId: null,
          errorCode: 'PARTICIPANT_NOT_ALLOWED',
        });
        stoppedReason = 'PARTICIPANT_NOT_ALLOWED';
        break;
      }

      const snapshot = session.agentProfileSnapshot ?? {};
      const harnessSessionId =
        typeof snapshot.harnessSessionId === 'string' ? snapshot.harnessSessionId : null;
      if (!harnessSessionId || !this.agentRunService) {
        turns.push({
          participantId: session.participantId,
          status: 'SKIPPED',
          content: '',
          tokens: 0,
          platformRunId: null,
          errorCode: 'HARNESS_SESSION_MISSING',
        });
        stoppedReason = 'HARNESS_SESSION_MISSING';
        break;
      }

      const transcript = this.recentTranscript(roomRunId);
      const prompt = buildPrompt({
        participantId: session.participantId,
        systemInstruction:
          typeof snapshot.systemInstruction === 'string' ? snapshot.systemInstruction : null,
        transcript,
      });

      const runRecord = await this.agentRunService.turn(
        harnessSessionId,
        prompt,
        input.timeoutSeconds ?? 120,
      );
      const harnessSession = this.sessionStore.get(harnessSessionId);
      const content = harnessSession?.runId
        ? lastAssistantMessage(this.runStore.listRunEvents(harnessSession.runId))
        : '';

      if (!content) {
        // 不伪造内容：模型侧失败/空输出都如实停在 FAILED
        turns.push({
          participantId: session.participantId,
          status: 'FAILED',
          content: '',
          tokens: 0,
          platformRunId: runRecord.id,
          errorCode: runRecord.errorCode ?? 'NO_CONTENT',
        });
        stoppedReason = runRecord.errorCode ?? 'NO_CONTENT';
        break;
      }

      const tokens = estimateTokens(content);
      try {
        this.orchestrator.dispatchTurn(roomRunId, {
          participantId: session.participantId,
          allowedParticipants: allowed,
          content,
          tokens,
        });
      } catch (err) {
        const code = err instanceof AppError ? err.code : 'ROOM_TURN_REJECTED';
        turns.push({
          participantId: session.participantId,
          status: 'FAILED',
          content,
          tokens: 0,
          platformRunId: runRecord.id,
          errorCode: code,
        });
        stoppedReason = code;
        break;
      }

      turns.push({
        participantId: session.participantId,
        status: 'SUCCEEDED',
        content,
        tokens,
        platformRunId: runRecord.id,
      });
      speaker = this.nextSpeaker(roomRunId, allowed, session.participantId);
    }

    this.publish(roomRunId);
    return { run: this.roomStore.getRun(roomRunId) ?? run, turns, stoppedReason };
  }

  /** 轮询取下一个发言人：以最后一条 AGENT_MESSAGE 的发言者为基准；无则取首位。 */
  private nextSpeaker(roomRunId: string, allowed: string[], after?: string): string {
    const base = after ?? this.lastAgentSpeaker(roomRunId);
    const idx = base ? allowed.indexOf(base) : -1;
    return allowed[(idx + 1) % allowed.length] ?? allowed[0] ?? '';
  }

  private lastAgentSpeaker(roomRunId: string): string | null {
    const events = this.roomStore.listEvents(roomRunId);
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i];
      if (e && e.eventType === 'AGENT_MESSAGE') return e.actorRef;
    }
    return null;
  }

  /** 最近 10 条对话（USER_MESSAGE / AGENT_MESSAGE），供提示词组装。 */
  private recentTranscript(roomRunId: string): { actorRef: string; content: string }[] {
    const out: { actorRef: string; content: string }[] = [];
    for (const e of this.roomStore.listEvents(roomRunId)) {
      if (e.eventType !== 'USER_MESSAGE' && e.eventType !== 'AGENT_MESSAGE') continue;
      const content = e.payload?.content;
      if (typeof content === 'string' && content.trim()) {
        out.push({ actorRef: e.actorRef, content });
      }
    }
    return out.slice(-10);
  }

  /** 只推送本次新增的事件（既有实现会把全部历史事件重推一遍，导致前端重复）。 */
  private publish(roomRunId: string): void {
    if (!this.hub) return;
    const seen = this.watermarks.get(roomRunId) ?? 0;
    const events: RoomEvent[] = this.roomStore.listEventsAfter(roomRunId, seen);
    for (const e of events) {
      this.hub.publish(roomRunId, {
        sequence: e.sequence,
        eventType: e.eventType,
        payload: e.payload,
        createdAt: e.createdAt,
      });
    }
    const last = events[events.length - 1];
    if (last) this.watermarks.set(roomRunId, last.sequence);
  }

  private readonly watermarks = new Map<string, number>();
}
