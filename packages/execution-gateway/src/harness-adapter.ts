import type { HarnessToolId, ToolPolicy } from '@workbench/contracts';

/**
 * Harness Adapter 契约（26 SPEC §13 + 设计 §6.9）。
 *
 * 平台调用 DeepSeek Harness 或其他 Harness 的唯一入口。Adapter 必须把第三方
 * 事件归一化为 `HarnessEvent`，不得把第三方对象直接暴露给上层（29 SPEC §4）。
 */

/** 归一化的 Harness 事件。 */
export interface HarnessEvent {
  sequence: number;
  type: 'message' | 'tool_call' | 'tool_result' | 'state' | 'error';
  payload: Record<string, unknown>;
  createdAt: string;
}

/** 归一化的消息（角色限定，禁止把系统指令来源标注为可信上下文之外）。 */
export interface HarnessMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

/** 发起一次 Harness 回合的请求。 */
export interface HarnessRunRequest {
  sessionId: string;
  modelProfileId: string;
  /** 系统指令/提示（会话固定快照的一部分）。 */
  prompt: string;
  messages: HarnessMessage[];
  tools: HarnessToolId[];
  toolPolicy: ToolPolicy;
  maxTokens?: number;
  timeoutSeconds?: number;
}

/** Harness 返回的结构化工具调用。 */
export interface HarnessToolCall {
  id: string;
  toolId: HarnessToolId;
  arguments: Record<string, unknown>;
}

/** 一次 Harness 回合的结果。 */
export interface HarnessRunResponse {
  content: string;
  toolCalls: HarnessToolCall[];
  stopReason: 'end' | 'tool' | 'max_tokens' | 'cancelled' | 'timeout' | 'error';
  usage?: { promptTokens: number; completionTokens: number };
}

/** Harness 健康状态。 */
export interface HarnessHealth {
  ok: boolean;
  detail?: string;
}

/**
 * Harness Adapter：可替换 Agent 内核的统一调用契约。
 * 首期实现：DeepSeek Harness（P4-02）、Mock（P4-07 降级）。
 */
export interface HarnessAdapter {
  health(): Promise<HarnessHealth>;
  run(request: HarnessRunRequest): Promise<HarnessRunResponse>;
  stream(request: HarnessRunRequest): AsyncIterable<HarnessEvent>;
  cancel(sessionId: string): Promise<void>;
}
