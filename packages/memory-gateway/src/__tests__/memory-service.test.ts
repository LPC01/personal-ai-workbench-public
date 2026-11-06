import { describe, expect, it } from 'vitest';
import { InMemoryMemoryProvider } from '../in-memory-provider.js';
import { MemoryService } from '../memory-service.js';

describe('只读 Resource 导入 + 项目范围检索（§14.2）', () => {
  it('只读导入 + 项目内召回', async () => {
    const service = new MemoryService(new InMemoryMemoryProvider());
    await service.importReadOnlyResource('proj-a', 'meeting', '会议纪要：数据交换空间');
    const hits = await service.searchProject('proj-a', '数据交换');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.uri).toContain('proj-a');
  });

  it('跨项目隔离：B 项目检索不到 A 项目资源', async () => {
    const service = new MemoryService(new InMemoryMemoryProvider());
    await service.importReadOnlyResource('proj-a', 'doc', '数据交换空间经验');
    await service.importReadOnlyResource('proj-b', 'doc', '无关内容');
    const hits = await service.searchProject('proj-b', '数据交换');
    expect(hits).toHaveLength(0);
  });

  it('limit 生效', async () => {
    const service = new MemoryService(new InMemoryMemoryProvider());
    for (let i = 0; i < 5; i++) {
      await service.importReadOnlyResource('p', `doc-${i}`, `共同关键词 ${i}`);
    }
    const hits = await service.searchProject('p', '共同关键词', 3);
    expect(hits.length).toBeLessThanOrEqual(3);
  });
});
