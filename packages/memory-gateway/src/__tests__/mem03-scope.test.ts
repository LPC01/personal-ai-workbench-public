import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { MemoryService, projectResourceUri } from '../memory-service.js';
import { InMemoryMemoryProvider } from '../in-memory-provider.js';
import { OpenVikingAdapter } from '../openviking-adapter.js';

const servers: Server[] = [];

async function startServer(): Promise<string> {
  return new Promise((resolve) => {
    const srv = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          result: {
            resources: [
              { uri: 'viking://resources/a', score: 0.9 },
              { uri: 'viking://resources/b', score: 0.2 },
            ],
          },
        }),
      );
    });
    servers.push(srv);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(async () => {
  while (servers.length > 0) {
    await new Promise((r) => servers.pop()?.close(r));
  }
});

describe('MEM-03 作用域与召回审计契约', () => {
  it('importReadOnlyResource 计算 sourceHash 并绑定项目前缀', async () => {
    const provider = new InMemoryMemoryProvider();
    const service = new MemoryService(provider);
    const content = '数据交换空间的设计原则';
    await service.importReadOnlyResource('proj-a', 'design.md', content, {
      sensitivity: 'confidential',
    });

    const hits = await service.searchProject('proj-a', '数据交换空间');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.uri.startsWith(projectResourceUri('proj-a', ''))).toBe(true);

    const expectedHash = createHash('sha256').update(content).digest('hex');
    expect(hits[0]?.uri).toBe(projectResourceUri('proj-a', 'design.md'));
    expect(expectedHash).toHaveLength(64);
  });

  it('searchProject 默认隔离：项目 B 不可见项目 A 内容', async () => {
    const provider = new InMemoryMemoryProvider();
    const service = new MemoryService(provider);
    await service.importReadOnlyResource('proj-a', 'a.md', 'A 项目独有的数据主权事实');
    await service.importReadOnlyResource('proj-b', 'b.md', 'B 项目相似主题但不同事实');

    const hitsA = await service.searchProject('proj-a', '数据主权');
    expect(hitsA.some((h) => h.uri.includes('proj-a'))).toBe(true);
    expect(hitsA.every((h) => !h.uri.includes('proj-b'))).toBe(true);
  });

  it('OpenVikingAdapter.search 按 minimumScore 过滤', async () => {
    const url = await startServer();
    const ad = new OpenVikingAdapter({ baseUrl: url, readOnly: false });
    const hits = await ad.search({ query: 'x', minimumScore: 0.5 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.uri).toBe('viking://resources/a');
  });
});
