import { describe, expect, it } from 'vitest';
import { InMemoryMemoryCenterStore } from '../in-memory-memory-center.js';
import { InMemoryMemoryProvider } from '../in-memory-provider.js';
import { MemoryRecallService } from '../memory-recall.js';
import { MemoryReviewService } from '../memory-review.js';
import { MemoryService } from '../memory-service.js';

describe('记忆中心投影（known-limitations #6）', () => {
  it('Candidate Inbox：propose 后可按项目与状态列出', async () => {
    const provider = new InMemoryMemoryProvider();
    const center = new InMemoryMemoryCenterStore();
    const review = new MemoryReviewService(provider, undefined, center);

    const ref = await review.propose('经验：数据交换空间以 dataspace 为界', 'project', {
      projectId: 'proj-a',
      sourceUri: 'issue:iss-1',
    });
    await review.propose('B 项目经验', 'project', { projectId: 'proj-b' });

    expect(review.listCandidates({ projectId: 'proj-a' })).toHaveLength(1);
    expect(review.listCandidates({ statuses: ['CANDIDATE'] })).toHaveLength(2);

    review.verify(ref);
    expect(review.listCandidates({ projectId: 'proj-a', statuses: ['CANDIDATE'] })).toHaveLength(0);
    expect(review.listCandidates({ projectId: 'proj-a', statuses: ['VERIFIED'] })).toHaveLength(1);
    expect(review.listCandidates({ projectId: 'proj-a' })[0]?.sourceUri).toBe('issue:iss-1');

    await review.activate(ref);
    expect(review.status(ref)).toBe('ACTIVE');
    expect(review.listCandidates({ projectId: 'proj-a' })[0]?.status).toBe('ACTIVE');
  });

  it('审核状态持久化：换一个服务实例（模拟重启）仍可读到候选', async () => {
    const provider = new InMemoryMemoryProvider();
    const center = new InMemoryMemoryCenterStore();
    const first = new MemoryReviewService(provider, undefined, center);
    const ref = await first.propose('跨重启可见的候选', 'project', { projectId: 'proj-a' });

    const second = new MemoryReviewService(provider, undefined, center);
    expect(second.status(ref)).toBe('CANDIDATE');
    expect(second.listCandidates({ projectId: 'proj-a' })).toHaveLength(1);
  });

  it('supersede 记录取代关系（Superseded 子树数据源）', async () => {
    const provider = new InMemoryMemoryProvider();
    const center = new InMemoryMemoryCenterStore();
    const review = new MemoryReviewService(provider, undefined, center);
    const oldRef = await review.propose('旧结论', 'project');
    const newRef = await review.propose('新结论', 'project');

    review.supersede(oldRef, newRef);
    const superseded = review.listCandidates({ statuses: ['SUPERSEDED'] });
    expect(superseded).toHaveLength(1);
    expect(superseded[0]?.supersededBy).toBe(newRef.uri);
  });

  it('候选 uri 唯一：activate 后再次提议不复用旧 uri（不互相覆盖）', async () => {
    const provider = new InMemoryMemoryProvider();
    const center = new InMemoryMemoryCenterStore();
    const review = new MemoryReviewService(provider, undefined, center);

    const first = await review.propose('第一条', 'project', { projectId: 'proj-a' });
    review.verify(first);
    await review.activate(first);
    const second = await review.propose('第二条', 'project', { projectId: 'proj-a' });

    expect(second.uri).not.toBe(first.uri);
    const all = review.listCandidates({ projectId: 'proj-a' });
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.status).sort()).toEqual(['ACTIVE', 'CANDIDATE']);
  });

  it('跳过 verify 直接 activate 仍被状态机拒绝', async () => {
    const provider = new InMemoryMemoryProvider();
    const review = new MemoryReviewService(provider);
    const ref = await review.propose('内容', 'project');
    await expect(review.activate(ref)).rejects.toThrow(/非法 Memory 状态转换/);
  });

  it('资源导入落投影：可列全量 Resources（按项目隔离）', async () => {
    const provider = new InMemoryMemoryProvider();
    const center = new InMemoryMemoryCenterStore();
    const service = new MemoryService(provider, center);

    await service.importReadOnlyResource('proj-a', 'intro', '内容 A', { sensitivity: 'internal' });
    await service.importReadOnlyResource('proj-a', 'design', '内容 B');
    await service.importReadOnlyResource('proj-b', 'intro', '内容 C', { sensitivity: 'public' });

    expect(service.listResources()).toHaveLength(3);
    const a = service.listResources('proj-a');
    expect(a).toHaveLength(2);
    expect(a.map((r) => r.uri).sort()).toEqual(['project:proj-a:design', 'project:proj-a:intro']);
    expect(a.find((r) => r.name === 'intro')?.sensitivity).toBe('internal');
  });

  it('召回写入审计：可列出并支持项目隔离', async () => {
    const provider = new InMemoryMemoryProvider();
    const center = new InMemoryMemoryCenterStore();
    const service = new MemoryService(provider, center);
    const recall = new MemoryRecallService(provider, center);

    await service.importReadOnlyResource('proj-a', 'note', '数据交换空间的内部经验');
    await service.importReadOnlyResource('proj-b', 'note', '完全无关内容');

    const result = await recall.recall('数据交换', 'project', 2048, { projectId: 'proj-a' });
    expect(result.hits.every((h) => h.uri.startsWith('project:proj-a:'))).toBe(true);
    expect(result.record.hitUris).toHaveLength(1);

    const audits = center.listRecallAudits({ projectId: 'proj-a' });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.query).toBe('数据交换');
    expect(audits[0]?.budgetTokens).toBe(2048);
    expect(audits[0]?.totalTokens).toBeGreaterThan(0);
    expect(audits[0]?.injectedPosition).toBe('context');

    expect(center.listRecallAudits({ projectId: 'proj-b' })).toHaveLength(0);
  });
});
