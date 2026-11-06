import type {
  ModelUsageByDay,
  ModelUsageByModel,
  ModelUsageInput,
  ModelUsageOverview,
  ModelUsageRecord,
} from '@workbench/contracts';
import type { ModelUsageStore } from '@workbench/persistence';

/** 每 token 单价（单位：元）。 */
export interface UsagePricing {
  inputPerToken: number;
  outputPerToken: number;
}

/**
 * 模型使用量服务（P8-02）：记录 + 成本计算 + 聚合查询。
 * 成本优先取调用方传入值；未传入则按模型单价映射计算（未登记的模型成本为 0）。
 */
export class ModelUsageService {
  constructor(
    private readonly store: ModelUsageStore,
    private readonly pricing: Record<string, UsagePricing> = {},
  ) {}

  computeCost(modelId: string, promptTokens: number, completionTokens: number): number {
    const p = this.pricing[modelId];
    if (!p) return 0;
    return promptTokens * p.inputPerToken + completionTokens * p.outputPerToken;
  }

  record(input: Omit<ModelUsageInput, 'cost'> & { cost?: number }): ModelUsageRecord {
    const cost =
      input.cost ?? this.computeCost(input.modelId, input.promptTokens, input.completionTokens);
    return this.store.record({ ...input, cost });
  }

  overview(): ModelUsageOverview {
    return this.store.overview();
  }

  byModel(): ModelUsageByModel[] {
    return this.store.byModel();
  }

  byDay(): ModelUsageByDay[] {
    return this.store.byDay();
  }
}
