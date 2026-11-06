import type { ParticipantInput, RoomEvent } from './api';

/**
 * 聊天室运行视图的纯函数层（UI-10）。
 *
 * 设计遵循调研结论（OpenHands `use-event-store`）：**事件表是唯一真源**，
 * 时间线、发言者、任务板摘要都由它派生，UI 不各自维护一份列表。
 */

/** Harness 工具白名单（26 SPEC §13；与后端 `harnessToolIds` 一致）。 */
export const HARNESS_TOOL_IDS = [
  'project.describe',
  'project.commands.list',
  'project.command.run',
  'run.status',
  'run.events',
  'run.cancel',
  'artifact.list',
  'artifact.read',
  'artifact.publish',
  'memory.search',
  'memory.read',
  'memory.candidate',
  'approval.request',
  'approval.status',
] as const;

/** 任务板状态（29 SPEC §9.3）。 */
export const WORK_ITEM_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'VERIFYING',
  'ACCEPTED',
  'REWORK',
  'CANCELLED',
] as const;

export const WORK_ITEM_STATUS_LABELS: Record<string, string> = {
  OPEN: '待认领',
  ASSIGNED: '已指派',
  IN_PROGRESS: '进行中',
  SUBMITTED: '已提交',
  VERIFYING: '验证中',
  ACCEPTED: '已验收',
  REWORK: '返工',
  CANCELLED: '已取消',
};

export interface TimelineBlock {
  kind: 'user' | 'agent' | 'system';
  key: string;
  actorRef: string;
  text: string;
  sequence: number;
  createdAt: string;
  eventType: string;
  /** 同一发言人的连续消息合并条数（>1 时在 UI 上标注）。 */
  merged: number;
}

/** 事件去重 + 排序（SSE 重推 / 历史回放会重复，按 sequence 幂等合并）。 */
export function dedupeEvents(events: RoomEvent[]): RoomEvent[] {
  const bySeq = new Map<number, RoomEvent>();
  for (const e of events) {
    const prev = bySeq.get(e.sequence);
    if (!prev) bySeq.set(e.sequence, e);
  }
  return [...bySeq.values()].sort((a, b) => a.sequence - b.sequence);
}

/** 把事件流派生为时间线块：用户/Agent 发言成块，其余为系统行。 */
export function buildTimeline(events: RoomEvent[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  for (const e of dedupeEvents(events)) {
    const content = typeof e.payload?.content === 'string' ? e.payload.content : '';
    const isUser = e.eventType === 'USER_MESSAGE';
    const isAgent = e.eventType === 'AGENT_MESSAGE';
    if (isUser || isAgent) {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === (isUser ? 'user' : 'agent') && last.actorRef === e.actorRef) {
        // 同一发言人连续发言：合并为一块，保留最后一条（内容已是全文）
        last.text = content;
        last.sequence = e.sequence;
        last.createdAt = e.createdAt;
        last.merged += 1;
        continue;
      }
      blocks.push({
        kind: isUser ? 'user' : 'agent',
        key: `${e.sequence}`,
        actorRef: e.actorRef,
        text: content,
        sequence: e.sequence,
        createdAt: e.createdAt,
        eventType: e.eventType,
        merged: 1,
      });
      continue;
    }
    blocks.push({
      kind: 'system',
      key: `${e.sequence}`,
      actorRef: e.actorRef,
      text: systemText(e),
      sequence: e.sequence,
      createdAt: e.createdAt,
      eventType: e.eventType,
      merged: 1,
    });
  }
  return blocks;
}

/** 系统事件的可读文案（说人话，不直接甩事件名）。 */
function systemText(e: RoomEvent): string {
  switch (e.eventType) {
    case 'ROOM_RUN_CREATED':
      return 'Run 已创建（尚未启动编排）';
    case 'CONTEXT_SNAPSHOT_CREATED':
      return '上下文快照已固定（不可变，参与者共用）';
    case 'AGENT_TURN_STARTED':
      return `第 ${String(e.payload?.turn ?? '?')} 轮开始`;
    case 'TASK_ASSIGNED':
      return `任务已指派：${String(e.payload?.kind ?? '')} → ${String(e.payload?.assigneeRef ?? '未指派')}`;
    case 'HANDOFF_REQUESTED':
      return `交接请求：${String(e.payload?.objective ?? '')}`;
    case 'HANDOFF_COMPLETED':
      return `交接完成 → ${String(e.payload?.workItemId ?? '')}`;
    case 'TOOL_CALL_COMPLETED':
      return `工具调用完成（${e.payload?.ok ? '成功' : '失败'}）：${String(e.payload?.runId ?? '')}`;
    case 'BUDGET_WARNING':
      return `预算告警：${String(e.payload?.reason ?? '')}`;
    case 'ROOM_RUN_PAUSED':
      return 'Run 已暂停';
    case 'ROOM_RUN_RESUMED':
      return 'Run 已恢复';
    case 'ROOM_RUN_COMPLETED':
      return 'Run 已完成';
    default:
      return e.eventType;
  }
}

/** 下一个发言人（与后端轮询规则一致：最后发言人的下一位）。 */
export function nextSpeaker(allowed: string[], lastAgentSpeaker: string | null): string | null {
  if (allowed.length === 0) return null;
  const idx = lastAgentSpeaker ? allowed.indexOf(lastAgentSpeaker) : -1;
  return allowed[(idx + 1) % allowed.length] ?? allowed[0] ?? null;
}

/** 取最后一位发言的 Agent（用户消息不算）。 */
export function lastAgentSpeaker(events: RoomEvent[]): string | null {
  for (const e of dedupeEvents(events).slice().reverse()) {
    if (e.eventType === 'AGENT_MESSAGE') return e.actorRef;
  }
  return null;
}

/** 停机原因中文化（如实翻译后端 errorCode，不美化）。 */
export function describeStopReason(code: string | null): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    ROOM_BUDGET_EXCEEDED: '触及预算上限，本轮未继续调用模型',
    NO_CONTENT: '模型返回空内容（可能是 mock 脚本用尽或 adapter 未产出）',
    HARNESS_UNAVAILABLE: 'Harness 不可用（健康检查失败）',
    TIMEOUT: '模型调用超时',
    HARNESS_ERROR: 'Harness 调用出错',
    TOOL_TURN_LIMIT: '工具回环超过最大轮数',
    HARNESS_SESSION_MISSING: '该参与者未绑定 Harness Session（启动时未填 Harness Profile）',
    PARTICIPANT_NOT_ALLOWED: '指定的发言人不在协议允许集合内',
    ROOM_RUN_STATE_CONFLICT: '当前 Run 状态不接受发言',
  };
  return map[code] ?? code;
}

export interface ParticipantParseResult {
  ok: boolean;
  participants: ParticipantInput[];
  error: string | null;
}

/**
 * 解析「高级模式」下的参与者 JSON。
 * 借鉴 AutoGen Studio 的 表单 ⇄ JSON 双模：JSON 是第二入口，出错必须可回退。
 */
export function parseParticipantsJson(text: string): ParticipantParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, participants: [], error: 'JSON 为空' };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, participants: [], error: `JSON 解析失败：${(e as Error).message}` };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, participants: [], error: '顶层必须是数组' };
  }
  const participants: ParticipantInput[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, participants: [], error: `第 ${i + 1} 项不是对象` };
    }
    const p = item as Record<string, unknown>;
    const id = typeof p.participantId === 'string' ? p.participantId.trim() : '';
    if (!id) return { ok: false, participants: [], error: `第 ${i + 1} 项缺少 participantId` };
    const binding = (p.modelBinding ?? {}) as Record<string, unknown>;
    const policy = (p.toolPolicy ?? {}) as Record<string, unknown>;
    participants.push({
      participantId: id,
      agentProfileId: typeof p.agentProfileId === 'string' ? p.agentProfileId : undefined,
      harnessProfileId: typeof p.harnessProfileId === 'string' ? p.harnessProfileId : undefined,
      modelBinding: {
        modelProfileId: typeof binding.modelProfileId === 'string' ? binding.modelProfileId : '',
        providerId: typeof binding.providerId === 'string' ? binding.providerId : undefined,
        revision: typeof binding.revision === 'number' ? binding.revision : 1,
      },
      toolPolicy: {
        allowedTools: Array.isArray(policy.allowedTools)
          ? policy.allowedTools.filter((t): t is string => typeof t === 'string')
          : [],
      },
      systemInstruction: typeof p.systemInstruction === 'string' ? p.systemInstruction : undefined,
    });
  }
  return { ok: true, participants, error: null };
}

/** 把参与者序列化为 JSON（表单 → JSON 双模切换时保持可读）。 */
export function stringifyParticipants(participants: ParticipantInput[]): string {
  return JSON.stringify(participants, null, 2);
}

/** 预算进度（0~1，超过即封顶）与文案。 */
export function budgetProgress(
  used: number | undefined,
  limit: number | undefined,
): {
  ratio: number;
  label: string;
} {
  const u = typeof used === 'number' ? used : 0;
  const l = typeof limit === 'number' && limit > 0 ? limit : 0;
  if (l === 0) return { ratio: 0, label: `${u}（未设上限）` };
  return { ratio: Math.min(1, u / l), label: `${u} / ${l}` };
}
