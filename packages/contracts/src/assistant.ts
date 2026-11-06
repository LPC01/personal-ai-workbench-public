import type { HarnessToolId } from './harness.js';

/**
 * Assistant 草稿（26 SPEC §10.1 L1 Assistant：Prompt、Schema、模型要求、工具白名单）。
 * L1 Assistant 由系统提示、结构化输入/输出 Schema、模型要求与工具白名单定义。
 */

/** 输入/输出 JSON Schema（结构化对象）。 */
export interface AssistantSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
}

/** 模型要求（结构化输出 / 最小上下文）。 */
export interface AssistantModelRequirements {
  structuredOutput?: boolean;
  minimumContextTokens?: number;
}

/** Assistant 草稿：绑定到扩展草稿的 L1 内容。 */
export interface AssistantDraft {
  id: string;
  extensionDraftId: string;
  systemPrompt: string;
  inputSchema: AssistantSchema;
  outputSchema: AssistantSchema;
  toolWhitelist: HarnessToolId[];
  modelRequirements: AssistantModelRequirements;
  createdAt: string;
  updatedAt: string;
}

/** 创建/更新 Assistant 草稿的输入。 */
export interface AssistantDraftInput {
  systemPrompt: string;
  inputSchema: AssistantSchema;
  outputSchema: AssistantSchema;
  toolWhitelist?: HarnessToolId[];
  modelRequirements?: AssistantModelRequirements;
}
