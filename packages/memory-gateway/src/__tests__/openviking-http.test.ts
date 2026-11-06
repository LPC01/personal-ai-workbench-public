import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { OpenVikingAdapter } from '../openviking-adapter.js';

const servers: Server[] = [];
const tmpDirs: string[] = [];

interface Captured {
  method: string;
  url: string;
  apiKey: string;
  body: unknown;
}

async function startServer(
  handler: (req: Captured) => [number, unknown],
): Promise<{ url: string; calls: Captured[] }> {
  const calls: Captured[] = [];
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => {
        raw += d;
      });
      req.on('end', () => {
        const captured: Captured = {
          method: req.method ?? '',
          url: req.url ?? '',
          apiKey: (req.headers['x-api-key'] as string) ?? '',
          body: raw
            ? (() => {
                try {
                  return JSON.parse(raw) as unknown;
                } catch {
                  return raw; // multipart 等非 JSON body
                }
              })()
            : undefined,
        };
        calls.push(captured);
        const [status, body] = handler(captured);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      });
    });
    servers.push(srv);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, calls });
    });
  });
}

function adapter(url: string, apiKey?: string): OpenVikingAdapter {
  const dir = mkdtempSync(join(tmpdir(), 'wb-ov-http-'));
  tmpDirs.push(dir);
  return new OpenVikingAdapter({ baseUrl: url, dataDir: dir, readOnly: false, apiKey });
}

afterEach(async () => {
  while (servers.length > 0) {
    await new Promise((r) => servers.pop()?.close(r));
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('OpenVikingAdapter 真实 HTTP（MEM-02）', () => {
  it('indexResource 走 temp_upload + add_resource(to 映射)，且相同内容幂等', async () => {
    let uploads = 0;
    let adds = 0;
    const { url, calls } = await startServer((req) => {
      if (req.url?.startsWith('/api/v1/resources/temp_upload')) {
        uploads += 1;
        return [200, { status: 'ok', result: { temp_file_id: 'upload_xxx.md' } }];
      }
      if (req.url?.startsWith('/api/v1/resources')) {
        adds += 1;
        return [200, { status: 'ok', result: { root_uri: 'viking://resources/project/A/doc' } }];
      }
      return [404, {}];
    });
    const ad = adapter(url, 'ov-key-123');
    const r1 = await ad.indexResource({ uri: 'project:A:doc', content: 'same content' });
    const r2 = await ad.indexResource({ uri: 'project:A:doc', content: 'same content' });
    expect(r1.uri).toBe('project:A:doc');
    expect(r2.uri).toBe('project:A:doc');
    expect(uploads).toBe(1); // 幂等：第二次未重复上传
    expect(adds).toBe(1);

    const addCall = calls.find((c) => c.url === '/api/v1/resources' && c.method === 'POST');
    expect(addCall).toBeDefined();
    // `:` 分隔符映射为 `/`，规避 OpenViking Windows 非法字符
    expect((addCall?.body as { to?: string })?.to).toBe('viking://resources/project/A/doc');
    expect((addCall?.body as { temp_file_id?: string })?.temp_file_id).toBe('upload_xxx.md');
    expect(calls.some((c) => c.apiKey === 'ov-key-123')).toBe(true);
  });

  it('search POST /search/find 用 / 分隔 target_uri 并反向映射 uri', async () => {
    const { url, calls } = await startServer((req) => {
      if (req.url?.startsWith('/api/v1/search/find')) {
        return [
          200,
          {
            status: 'ok',
            result: {
              resources: [
                { uri: 'viking://resources/project/A/dataspace/dataspace.md', score: 0.9 },
              ],
            },
          },
        ];
      }
      return [404, {}];
    });
    const ad = adapter(url);
    const hits = await ad.search({ query: '数据交换空间', projectId: 'A' });
    expect(hits).toHaveLength(1);
    // 反向映射回内部 `project:<id>:` 前缀，供 MemoryService 客户端过滤
    expect(hits[0]?.uri).toBe('project:A:dataspace/dataspace.md');
    expect(hits[0]?.score).toBe(0.9);
    const call = calls.find((c) => c.url?.startsWith('/api/v1/search/find'));
    expect((call?.body as { target_uri?: string })?.target_uri).toBe(
      'viking://resources/project/A/',
    );
  });

  it('search 未指定 projectId 时检索整个 resources 树', async () => {
    const { url, calls } = await startServer((req) => {
      if (req.url?.startsWith('/api/v1/search/find')) {
        return [200, { status: 'ok', result: { resources: [] } }];
      }
      return [404, {}];
    });
    const ad = adapter(url);
    await ad.search({ query: 'x' });
    const call = calls.find((c) => c.url?.startsWith('/api/v1/search/find'));
    expect((call?.body as { target_uri?: string })?.target_uri).toBe('viking://resources/');
  });

  it('read GET /content/read 返回内容', async () => {
    const { url } = await startServer((req) => {
      if (req.url?.startsWith('/api/v1/content/read')) {
        return [200, { content: '全文内容' }];
      }
      return [404, {}];
    });
    const ad = adapter(url);
    const doc = await ad.read('viking://resources/a');
    expect(doc.content).toBe('全文内容');
  });

  it('search 失败抛 MEMORY_PROVIDER_UNAVAILABLE', async () => {
    const { url } = await startServer(() => [500, {}]);
    const ad = adapter(url);
    await expect(ad.search({ query: 'x' })).rejects.toMatchObject({
      code: 'MEMORY_PROVIDER_UNAVAILABLE',
    });
  });

  it('indexResource temp_upload 失败抛 MEMORY_PROVIDER_UNAVAILABLE', async () => {
    const { url } = await startServer((req) => {
      if (req.url?.startsWith('/api/v1/resources/temp_upload')) {
        return [500, {}];
      }
      return [404, {}];
    });
    const ad = adapter(url);
    await expect(
      ad.indexResource({ uri: 'project:A:doc', content: 'content' }),
    ).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_UNAVAILABLE' });
  });
});
