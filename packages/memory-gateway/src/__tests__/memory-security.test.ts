import { describe, expect, it } from 'vitest';
import { InMemoryMemoryProvider } from '../in-memory-provider.js';
import { MemoryRecallService } from '../memory-recall.js';
import { MemoryReviewService } from '../memory-review.js';
import { MemoryService } from '../memory-service.js';

describe('P7-12 安全测试（跨项目隔离/错误记忆/密钥泄露）', () => {
  it('跨项目隔离：A 项目记忆不泄露给 B 项目', async () => {
    const provider = new InMemoryMemoryProvider();
    const service = new MemoryService(provider);
    await service.importReadOnlyResource('proj-a', 'secret-note', '数据交换空间的内部经验');
    await service.importReadOnlyResource('proj-b', 'note', '完全无关内容');

    const hitsA = await service.searchProject('proj-a', '数据交换');
    const hitsB = await service.searchProject('proj-b', '数据交换');
    expect(hitsA.length).toBeGreaterThan(0);
    expect(hitsB).toHaveLength(0);
  });

  it('错误记忆：Superseded/Revoked 默认不注入', async () => {
    const provider = new InMemoryMemoryProvider();
    const recall = new MemoryRecallService(provider);
    await provider.indexResource({ uri: 'wrong', content: '错误的旧结论', scope: 'project' });
    await provider.revoke({ uri: 'wrong' });

    const result = await recall.recall('错误的旧结论', 'project');
    expect(result.hits.some((h) => h.uri === 'wrong')).toBe(false);
    expect(result.injected).not.toContain('错误的旧结论');
  });

  it('密钥泄露：Secret 写入被拒绝且不进入 Memory', async () => {
    const provider = new InMemoryMemoryProvider();
    const review = new MemoryReviewService(provider);
    await expect(review.propose('api_key=sk-live-abcdefghijklmnop', 'project')).rejects.toThrow();

    // Secret 未进入 provider
    const hits = await provider.search({ query: 'sk-live', scope: 'project' });
    expect(hits).toHaveLength(0);
  });

  it('PII 不进入 Memory（邮箱/手机号拒绝）', async () => {
    const provider = new InMemoryMemoryProvider();
    const review = new MemoryReviewService(provider);
    await expect(review.propose('联系 user@example.com', 'project')).rejects.toThrow();
    await expect(review.propose('电话 13800138000', 'project')).rejects.toThrow();
  });
});
