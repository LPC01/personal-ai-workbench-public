import { describe, expect, it } from 'vitest';
import { InMemoryMemoryProvider } from '../in-memory-provider.js';
import { OpenVikingAdapter } from '../openviking-adapter.js';

describe('MemoryProvider 契约（§14.1）', () => {
  it('InMemoryMemoryProvider 索引 + 召回 + 读取', async () => {
    const p = new InMemoryMemoryProvider();
    await p.indexResource({ uri: 'res:1', content: '会议纪要：数据交换空间', scope: 'project' });
    await p.indexResource({ uri: 'res:2', content: '无关内容', scope: 'project' });

    const hits = await p.search({ query: '数据交换', scope: 'project' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.uri).toBe('res:1');

    const doc = await p.read('res:1');
    expect(doc.content).toContain('数据交换空间');
  });

  it('Candidate → activate 流转', async () => {
    const p = new InMemoryMemoryProvider();
    const ref = await p.createCandidate({ content: 'lesson-1', scope: 'project' });
    await p.activate(ref);
    const hits = await p.search({ query: 'lesson', scope: 'project' });
    expect(hits.some((h) => h.uri === ref.uri)).toBe(true);
  });

  it('supersede 后不再召回', async () => {
    const p = new InMemoryMemoryProvider();
    await p.indexResource({ uri: 'old', content: '旧经验', scope: 'project' });
    await p.indexResource({ uri: 'new', content: '新经验', scope: 'project' });
    await p.supersede({ uri: 'old' }, { uri: 'new' });
    const hits = await p.search({ query: '旧经验', scope: 'project' });
    expect(hits.some((h) => h.uri === 'old')).toBe(false);
  });

  it('export 导出指定作用域文档', async () => {
    const p = new InMemoryMemoryProvider();
    await p.indexResource({ uri: 'a', content: 'x', scope: 'project' });
    await p.indexResource({ uri: 'b', content: 'y', scope: 'run' });
    const bundle = await p.export('project');
    expect(bundle.documents.map((d) => d.uri)).toEqual(['a']);
  });
});

describe('OpenVikingAdapter 骨架（§14.1）', () => {
  it('health 未部署返回 UNAVAILABLE，检索失败抛 MEMORY_PROVIDER_UNAVAILABLE', async () => {
    const adapter = new OpenVikingAdapter({ baseUrl: 'http://127.0.0.1:1' });
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(health.status).toBe('UNAVAILABLE');
    await expect(adapter.search({ query: 'x' })).rejects.toMatchObject({
      code: 'MEMORY_PROVIDER_UNAVAILABLE',
    });
  });
});
