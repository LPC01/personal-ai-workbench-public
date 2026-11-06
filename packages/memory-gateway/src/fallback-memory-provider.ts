import type {
  ExportBundle,
  MemoryDocument,
  MemoryHealth,
  MemoryHit,
  MemoryProvider,
  MemoryQuery,
  MemoryRef,
  ResourceInput,
  ResourceRef,
} from '@workbench/contracts';

/**
 * 降级 Memory Provider（32 号 SPEC §4.5：停止 Sidecar 后自动降级）。
 * 主 Provider（OpenViking）健康时走主；UNAVAILABLE/DEGRADED 时自动切换到降级实现
 * （Markdown/SQLite 只读或关键词），并明确标注 degraded。
 */
export class FallbackMemoryProvider implements MemoryProvider {
  private degraded = false;

  constructor(
    private readonly primary: MemoryProvider,
    private readonly fallback: MemoryProvider,
  ) {}

  private async active(): Promise<MemoryProvider> {
    const health = await this.primary.health();
    this.degraded = health.status === 'UNAVAILABLE' || health.status === 'DEGRADED';
    return this.degraded ? this.fallback : this.primary;
  }

  async health(): Promise<MemoryHealth> {
    const h = await this.primary.health();
    if (h.status === 'UNAVAILABLE' || h.status === 'DEGRADED') {
      return {
        status: 'DEGRADED',
        ok: false,
        detail: `OpenViking 不可用，已降级到本地实现（${h.detail ?? h.status}）`,
      };
    }
    return h;
  }

  async indexResource(input: ResourceInput): Promise<ResourceRef> {
    return (await this.active()).indexResource(input);
  }

  async search(query: MemoryQuery): Promise<MemoryHit[]> {
    return (await this.active()).search(query);
  }

  async read(uri: string): Promise<MemoryDocument> {
    return (await this.active()).read(uri);
  }

  async createCandidate(input: import('@workbench/contracts').CandidateInput): Promise<MemoryRef> {
    return (await this.active()).createCandidate(input);
  }

  async activate(ref: MemoryRef): Promise<void> {
    return (await this.active()).activate(ref);
  }

  async supersede(oldRef: MemoryRef, newRef: MemoryRef): Promise<void> {
    return (await this.active()).supersede(oldRef, newRef);
  }

  async revoke(ref: MemoryRef): Promise<void> {
    return (await this.active()).revoke(ref);
  }

  async export(scope: import('@workbench/contracts').MemoryScope): Promise<ExportBundle> {
    return (await this.active()).export(scope);
  }
}
