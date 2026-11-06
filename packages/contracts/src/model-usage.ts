/**
 * 模型使用量、延迟与成本（26 SPEC §672：Metrics 含模型延迟/错误/token）。
 * 类型为纯契约，不含运行时实现。
 */

/** 单次模型调用使用记录。 */
export interface ModelUsageRecord {
  id: string;
  /** 关联的 model_profile id（可空，模型可能未在 profile 中登记）。 */
  modelProfileId: string | null;
  /** 冗余模型标识，便于跨 profile 聚合。 */
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  /** 端到端延迟（毫秒）。 */
  latencyMs: number;
  /** 计算后的成本（单位：元，浮点）。 */
  cost: number;
  createdAt: string;
}

/** 写入单条使用记录。 */
export interface ModelUsageInput {
  id?: string;
  modelProfileId?: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  cost: number;
}

/** 总量概览。 */
export interface ModelUsageOverview {
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  totalCost: number;
}

/** 按模型聚合。 */
export interface ModelUsageByModel {
  modelId: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
  totalCost: number;
}

/** 按天聚合（day 为 YYYY-MM-DD）。 */
export interface ModelUsageByDay {
  day: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
}
