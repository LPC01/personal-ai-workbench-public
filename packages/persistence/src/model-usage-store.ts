import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ModelUsageByDay,
  ModelUsageByModel,
  ModelUsageInput,
  ModelUsageOverview,
  ModelUsageRecord,
} from '@workbench/contracts';

interface UsageRow {
  id: string;
  model_profile_id: string | null;
  model_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  cost: number;
  created_at: string;
}

function mapUsage(row: UsageRow): ModelUsageRecord {
  return {
    id: row.id,
    modelProfileId: row.model_profile_id,
    modelId: row.model_id,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    latencyMs: row.latency_ms,
    cost: row.cost,
    createdAt: row.created_at,
  };
}

const USAGE_COLUMNS =
  'id, model_profile_id, model_id, prompt_tokens, completion_tokens, latency_ms, cost, created_at';

/** 模型使用量存储（P8-02：26 SPEC §672）。 */
export class ModelUsageStore {
  constructor(private readonly db: Database.Database) {}

  /** 记录一次模型调用。 */
  record(input: ModelUsageInput): ModelUsageRecord {
    const id = input.id ?? `usage_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO model_usage
          (id, model_profile_id, model_id, prompt_tokens, completion_tokens, latency_ms, cost, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.modelProfileId ?? null,
        input.modelId,
        input.promptTokens,
        input.completionTokens,
        input.latencyMs,
        input.cost,
        new Date().toISOString(),
      );
    return this.get(id) as ModelUsageRecord;
  }

  get(id: string): ModelUsageRecord | undefined {
    const row = this.db.prepare(`SELECT ${USAGE_COLUMNS} FROM model_usage WHERE id = ?`).get(id) as
      UsageRow | undefined;
    return row ? mapUsage(row) : undefined;
  }

  listAll(): ModelUsageRecord[] {
    const rows = this.db
      .prepare(`SELECT ${USAGE_COLUMNS} FROM model_usage ORDER BY created_at`)
      .all() as UsageRow[];
    return rows.map(mapUsage);
  }

  /** 总量概览。 */
  overview(): ModelUsageOverview {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS calls,
                COALESCE(SUM(prompt_tokens), 0) AS prompt,
                COALESCE(SUM(completion_tokens), 0) AS completion,
                COALESCE(SUM(latency_ms), 0) AS latency,
                COALESCE(SUM(cost), 0) AS cost
         FROM model_usage`,
      )
      .get() as {
      calls: number;
      prompt: number;
      completion: number;
      latency: number;
      cost: number;
    };
    return {
      totalCalls: row.calls,
      totalPromptTokens: row.prompt,
      totalCompletionTokens: row.completion,
      totalLatencyMs: row.latency,
      avgLatencyMs: row.calls > 0 ? Math.round(row.latency / row.calls) : 0,
      totalCost: row.cost,
    };
  }

  /** 按模型聚合。 */
  byModel(): ModelUsageByModel[] {
    const rows = this.db
      .prepare(
        `SELECT model_id,
                COUNT(*) AS calls,
                COALESCE(SUM(prompt_tokens), 0) AS prompt,
                COALESCE(SUM(completion_tokens), 0) AS completion,
                COALESCE(SUM(latency_ms), 0) AS latency,
                COALESCE(SUM(cost), 0) AS cost
         FROM model_usage
         GROUP BY model_id
         ORDER BY cost DESC`,
      )
      .all() as {
      model_id: string;
      calls: number;
      prompt: number;
      completion: number;
      latency: number;
      cost: number;
    }[];
    return rows.map((r) => ({
      modelId: r.model_id,
      calls: r.calls,
      promptTokens: r.prompt,
      completionTokens: r.completion,
      avgLatencyMs: r.calls > 0 ? Math.round(r.latency / r.calls) : 0,
      totalCost: r.cost,
    }));
  }

  /** 按天聚合（day = substr(created_at, 1, 10)，即 YYYY-MM-DD）。 */
  byDay(): ModelUsageByDay[] {
    const rows = this.db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day,
                COUNT(*) AS calls,
                COALESCE(SUM(prompt_tokens), 0) AS prompt,
                COALESCE(SUM(completion_tokens), 0) AS completion,
                COALESCE(SUM(cost), 0) AS cost
         FROM model_usage
         GROUP BY day
         ORDER BY day`,
      )
      .all() as { day: string; calls: number; prompt: number; completion: number; cost: number }[];
    return rows.map((r) => ({
      day: r.day,
      calls: r.calls,
      promptTokens: r.prompt,
      completionTokens: r.completion,
      totalCost: r.cost,
    }));
  }
}
