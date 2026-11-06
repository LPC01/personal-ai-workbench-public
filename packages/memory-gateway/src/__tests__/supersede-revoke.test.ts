import { describe, expect, it } from 'vitest';
import { InMemoryMemoryProvider } from '../in-memory-provider.js';

describe('Supersede/Revoke 和默认过滤（§14.2）', () => {
  it('supersede 后默认不召回', async () => {
    const provider = new InMemoryMemoryProvider();
    await provider.indexResource({ uri: 'old', content: '旧经验', scope: 'project' });
    await provider.indexResource({ uri: 'new', content: '新经验', scope: 'project' });
    await provider.supersede({ uri: 'old' }, { uri: 'new' });
    const hits = await provider.search({ query: '旧经验', scope: 'project' });
    expect(hits.some((h) => h.uri === 'old')).toBe(false);
  });

  it('revoke 后默认不召回', async () => {
    const provider = new InMemoryMemoryProvider();
    await provider.indexResource({ uri: 'a', content: '被撤销内容', scope: 'project' });
    await provider.revoke({ uri: 'a' });
    const hits = await provider.search({ query: '被撤销内容', scope: 'project' });
    expect(hits.some((h) => h.uri === 'a')).toBe(false);
  });

  it('未 supersede/revoke 的正常召回', async () => {
    const provider = new InMemoryMemoryProvider();
    await provider.indexResource({ uri: 'ok', content: '正常内容', scope: 'project' });
    const hits = await provider.search({ query: '正常内容', scope: 'project' });
    expect(hits.some((h) => h.uri === 'ok')).toBe(true);
  });
});
