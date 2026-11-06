import { describe, expect, it } from 'vitest';
import { InMemoryMemoryProvider } from '../in-memory-provider.js';
import { estimateTokens, MemoryRecallService, wrapUntrusted } from '../memory-recall.js';

describe('召回预算 / URI / 来源 / 注入审计（§14.2）', () => {
  it('召回命中记录 URI 并注入不可信上下文', async () => {
    const provider = new InMemoryMemoryProvider();
    await provider.indexResource({ uri: 'res:1', content: '数据交换空间经验', scope: 'project' });
    const service = new MemoryRecallService(provider);
    const result = await service.recall('数据交换', 'project');

    expect(result.hits[0]?.uri).toBe('res:1');
    expect(result.injected).toContain('<untrusted-memory>');
    expect(result.record.hitUris).toEqual(['res:1']);
  });

  it('token 预算裁剪：超出预算的命中不注入', async () => {
    const provider = new InMemoryMemoryProvider();
    await provider.indexResource({ uri: 'big', content: 'x'.repeat(1000), scope: 'project' });
    await provider.indexResource({ uri: 'small', content: 'small-content', scope: 'project' });

    const service = new MemoryRecallService(provider);
    const result = await service.recall('x', 'project', 10);
    expect(result.record.totalTokens).toBeLessThanOrEqual(10);
    expect(result.hits.length).toBeLessThan(2);
  });

  it('estimateTokens 粗略估算', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('12345678')).toBe(2);
  });

  it('wrapUntrusted 包裹不可信标记', () => {
    expect(wrapUntrusted('hello')).toBe('<untrusted-memory>\nhello\n</untrusted-memory>');
  });
});
