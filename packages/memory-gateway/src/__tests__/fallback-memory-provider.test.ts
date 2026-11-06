import { describe, expect, it } from 'vitest';
import type { MemoryProvider, MemoryQuery, MemoryHit, MemoryHealth } from '@workbench/contracts';
import { FallbackMemoryProvider } from '../fallback-memory-provider.js';
import { InMemoryMemoryProvider } from '../in-memory-provider.js';

function makePrimary(status: MemoryHealth['status']): MemoryProvider {
  return {
    async health(): Promise<MemoryHealth> {
      return { status, ok: status !== 'UNAVAILABLE' && status !== 'DEGRADED' };
    },
    async indexResource() {
      return { uri: 'primary' };
    },
    async search(): Promise<MemoryHit[]> {
      return [{ uri: 'primary-hit', score: 1 }];
    },
    async read(uri: string) {
      return { uri, content: 'primary', scope: 'project' };
    },
    async createCandidate() {
      return { uri: 'primary' };
    },
    async activate() {},
    async supersede() {},
    async revoke() {},
    async export() {
      return { scope: 'project', documents: [] };
    },
  };
}

describe('FallbackMemoryProvider（MEM-04 降级切换）', () => {
  it('主 Provider UNAVAILABLE 时降级到本地实现', async () => {
    const fallback = new InMemoryMemoryProvider();
    await fallback.indexResource({ uri: 'fb:1', content: '本地事实', scope: 'project' });
    const p = new FallbackMemoryProvider(makePrimary('UNAVAILABLE'), fallback);

    expect((await p.health()).status).toBe('DEGRADED');
    const hits = await p.search({ query: '本地事实' });
    expect(hits.some((h) => h.uri === 'fb:1')).toBe(true);
  });

  it('主 Provider READY 时走主实现', async () => {
    const fallback = new InMemoryMemoryProvider();
    const p = new FallbackMemoryProvider(makePrimary('READY_READWRITE'), fallback);

    expect((await p.health()).status).toBe('READY_READWRITE');
    const hits = await p.search({ query: 'x' } as MemoryQuery);
    expect(hits[0]?.uri).toBe('primary-hit');
  });
});
