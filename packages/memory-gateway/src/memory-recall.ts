import { randomUUID } from 'node:crypto';
import type {
  MemoryCenterPort,
  MemoryHit,
  MemoryProvider,
  MemoryScope,
} from '@workbench/contracts';

/** 召回审计记录（26 SPEC §14.2：记录查询、作用域、命中 URI、分数、token 和注入位置）。 */
export interface RecallRecord {
  query: string;
  scope: MemoryScope;
  hitUris: string[];
  totalTokens: number;
  budgetTokens: number;
  injectedPosition: 'context';
  createdAt: string;
}

export interface RecallResult {
  hits: MemoryHit[];
  /** 注入内容（标为不可信上下文）。 */
  injected: string;
  record: RecallRecord;
}

export interface RecallOptions {
  /** 限定项目（跨项目隔离，26 SPEC §14.4）。 */
  projectId?: string;
  /** 审计归属项目（与 projectId 一致时省略）。 */
  auditProjectId?: string;
}

/** 粗略 token 估算（约 4 字符/token）。 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** 召回内容标记为不可信上下文（§14.2：不得被当作系统指令）。 */
export function wrapUntrusted(content: string): string {
  return `<untrusted-memory>\n${content}\n</untrusted-memory>`;
}

/**
 * Memory 召回服务（26 SPEC §14.2）：token 预算裁剪 + URI/分数记录 + 不可信上下文注入审计。
 *
 * 传入 `center` 时，每次召回都会**追加一条审计记录**（检索与召回审计子树的数据源）。
 */
export class MemoryRecallService {
  constructor(
    private readonly provider: MemoryProvider,
    private readonly center?: MemoryCenterPort,
  ) {}

  async recall(
    query: string,
    scope: MemoryScope,
    budgetTokens = 2048,
    options: RecallOptions = {},
  ): Promise<RecallResult> {
    const all = await this.provider.search({ query, scope });
    const prefix = options.projectId ? `project:${options.projectId}:` : null;
    const hits = prefix ? all.filter((h) => h.uri.startsWith(prefix)) : all;

    const selected: MemoryHit[] = [];
    const injectedParts: string[] = [];
    let totalTokens = 0;

    for (const hit of hits) {
      const content = (await this.provider.read(hit.uri)).content;
      const tokens = estimateTokens(content);
      if (totalTokens + tokens > budgetTokens) {
        break;
      }
      totalTokens += tokens;
      selected.push(hit);
      injectedParts.push(wrapUntrusted(content));
    }

    const record: RecallRecord = {
      query,
      scope,
      hitUris: selected.map((h) => h.uri),
      totalTokens,
      budgetTokens,
      injectedPosition: 'context',
      createdAt: new Date().toISOString(),
    };
    this.center?.appendRecallAudit({
      id: randomUUID(),
      projectId: options.auditProjectId ?? options.projectId ?? null,
      ...record,
    });

    return { hits: selected, injected: injectedParts.join('\n'), record };
  }
}
