import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { HarnessRunRequest, HarnessRunResponse } from '../harness-adapter.js';
import { DeepSeekHarnessAdapter } from '../deepseek-harness-adapter.js';
import { createHarnessAdapter } from '../factory.js';
import type { HarnessProfile } from '@workbench/contracts';
import { AppError } from '@workbench/domain';

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});

function startServer(
  handler: (req: {
    method?: string;
    url?: string;
    body: unknown;
  }) => { status: number; json: unknown } | { sse: string },
): Promise<{ port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const result = handler({
          method: req.method,
          url: req.url,
          body: raw ? JSON.parse(raw) : null,
        });
        if ('sse' in result) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.end(result.sse);
          return;
        }
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.json));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      servers.push(server);
      resolve({ port: (server.address() as { port: number }).port });
    });
  });
}

const REQUEST: HarnessRunRequest = {
  sessionId: 'sess-1',
  modelProfileId: 'deepseek-code',
  prompt: '整理纪要',
  messages: [],
  tools: ['project.describe'],
  toolPolicy: { allowedToolIds: ['project.describe'], constraints: {} },
};

describe('DeepSeekHarnessAdapter', () => {
  it('health 返回 ok', async () => {
    const { port } = await startServer(() => ({ status: 200, json: { ok: true } }));
    const adapter = new DeepSeekHarnessAdapter({ baseUrl: `http://127.0.0.1:${port}` });
    expect((await adapter.health()).ok).toBe(true);
  });

  it('health 在服务不可达时返回 ok:false（降级）', async () => {
    const adapter = new DeepSeekHarnessAdapter({
      baseUrl: 'http://127.0.0.1:1',
      timeoutSeconds: 1,
    });
    expect((await adapter.health()).ok).toBe(false);
  });

  it('run 归一化返回结果', async () => {
    const { port } = await startServer(() => ({
      status: 200,
      json: { content: '纪要完成', toolCalls: [], stopReason: 'end' } satisfies HarnessRunResponse,
    }));
    const adapter = new DeepSeekHarnessAdapter({ baseUrl: `http://127.0.0.1:${port}` });
    const res = await adapter.run(REQUEST);
    expect(res.content).toBe('纪要完成');
    expect(res.stopReason).toBe('end');
  });

  it('run 非 2xx 抛错', async () => {
    const { port } = await startServer(() => ({ status: 503, json: { error: 'down' } }));
    const adapter = new DeepSeekHarnessAdapter({ baseUrl: `http://127.0.0.1:${port}` });
    await expect(adapter.run(REQUEST)).rejects.toThrow(/HTTP 503/);
  });

  it('stream 解析 SSE 帧并归一化事件序列', async () => {
    const { port } = await startServer(() => ({
      sse: `data: {"sequence":1,"type":"state","payload":{},"createdAt":"t"}\n\ndata: {"sequence":2,"type":"message","payload":{"content":"hi"},"createdAt":"t"}\n\n`,
    }));
    const adapter = new DeepSeekHarnessAdapter({ baseUrl: `http://127.0.0.1:${port}` });
    const events = [];
    for await (const e of adapter.stream(REQUEST)) events.push(e);
    expect(events.map((e) => e.sequence)).toEqual([1, 2]);
    expect(events.map((e) => e.type)).toEqual(['state', 'message']);
  });

  it('缺少 baseUrl 时构造即抛 HARNESS_UNAVAILABLE（不再静默指向默认地址）', () => {
    let code: string | undefined;
    try {
      new DeepSeekHarnessAdapter({});
    } catch (e) {
      code = (e as AppError).code;
    }
    expect(code).toBe('HARNESS_UNAVAILABLE');

    let blankCode: string | undefined;
    try {
      new DeepSeekHarnessAdapter({ baseUrl: '   ' });
    } catch (e) {
      blankCode = (e as AppError).code;
    }
    expect(blankCode).toBe('HARNESS_UNAVAILABLE');
  });

  it('factory 按 deepseek 类型创建 DeepSeekHarnessAdapter', () => {
    const profile: HarnessProfile = {
      id: 'deepseek-harness-local',
      name: 'DeepSeek Harness',
      adapterType: 'deepseek',
      config: { baseUrl: 'http://127.0.0.1:1' },
      revision: 1,
      createdAt: 't',
      updatedAt: 't',
    };
    const adapter = createHarnessAdapter(profile);
    expect(adapter).toBeInstanceOf(DeepSeekHarnessAdapter);
  });

  it('factory 对未支持类型抛错', () => {
    const profile: HarnessProfile = {
      id: 'x',
      name: 'X',
      adapterType: 'openai-agents',
      config: {},
      revision: 1,
      createdAt: 't',
      updatedAt: 't',
    };
    expect(() => createHarnessAdapter(profile)).toThrow(/openai-agents/);
  });
});
