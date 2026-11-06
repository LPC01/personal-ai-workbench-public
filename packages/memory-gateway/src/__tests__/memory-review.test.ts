import { describe, expect, it } from 'vitest';
import { InMemoryMemoryProvider } from '../in-memory-provider.js';
import { MemoryReviewService } from '../memory-review.js';

describe('Candidate→Verified→Active 审核（§9.3）', () => {
  it('propose → verify → activate 流转', async () => {
    const provider = new InMemoryMemoryProvider();
    const review = new MemoryReviewService(provider);
    const ref = await review.propose('数据交换空间经验', 'project');
    expect(review.status(ref)).toBe('CANDIDATE');

    review.verify(ref);
    expect(review.status(ref)).toBe('VERIFIED');

    await review.activate(ref);
    expect(review.status(ref)).toBe('ACTIVE');

    const hits = await provider.search({ query: '数据交换', scope: 'project' });
    expect(hits.some((h) => h.uri === ref.uri)).toBe(true);
  });

  it('跳过 verify 直接 activate 被状态机拒绝', async () => {
    const provider = new InMemoryMemoryProvider();
    const review = new MemoryReviewService(provider);
    const ref = await review.propose('内容', 'project');
    await expect(review.activate(ref)).rejects.toThrow(/非法 Memory 状态转换/);
  });

  it('propose 命中 Secret 被拒绝', async () => {
    const provider = new InMemoryMemoryProvider();
    const review = new MemoryReviewService(provider);
    await expect(review.propose('sk-abcdefghijklmnop123456', 'project')).rejects.toThrow();
  });

  it('supersede 候选', async () => {
    const provider = new InMemoryMemoryProvider();
    const review = new MemoryReviewService(provider);
    const ref = await review.propose('内容', 'project');
    review.supersede(ref);
    expect(review.status(ref)).toBe('SUPERSEDED');
  });
});
