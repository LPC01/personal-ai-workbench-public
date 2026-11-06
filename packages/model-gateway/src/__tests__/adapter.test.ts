import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { OllamaAdapter, OpenAICompatibleAdapter } from '../adapter.js';

const servers: Server[] = [];

interface Captured {
  body: unknown;
  auth?: string;
}

function mockOpenAI(
  respond: (body: unknown) => { status?: number; json: unknown },
): Promise<{ port: number; lastRequest: () => Captured }> {
  let captured: Captured = { body: null };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        captured = { body: raw ? JSON.parse(raw) : null, auth: req.headers.authorization };
        const r = respond(captured.body);
        res.writeHead(r.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.json));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      servers.push(server);
      resolve({ port: (server.address() as { port: number }).port, lastRequest: () => captured });
    });
  });
}

function mockStream(write: (res: import('node:http').ServerResponse) => void): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      write(res);
    });
    server.listen(0, '127.0.0.1', () => {
      servers.push(server);
      resolve((server.address() as { port: number }).port);
    });
  });
}

afterEach(() => {
  for (const s of servers) {
    s.closeAllConnections?.();
    s.close();
  }
  servers.length = 0;
});

describe('OpenAICompatibleAdapter', () => {
  it('calls /chat/completions and parses content + usage', async () => {
    const mock = await mockOpenAI(() => ({
      json: {
        choices: [{ message: { role: 'assistant', content: '你好' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      },
    }));
    const adapter = new OpenAICompatibleAdapter(`http://127.0.0.1:${mock.port}`, 'sk-test');

    const resp = await adapter.chat({
      model: 'qwen-local',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(resp.content).toBe('你好');
    expect(resp.usage).toEqual({ promptTokens: 5, completionTokens: 2 });
  });

  it('sends model/messages/temperature/max_tokens and Authorization', async () => {
    const mock = await mockOpenAI(() => ({ json: { choices: [] } }));
    const adapter = new OpenAICompatibleAdapter(`http://127.0.0.1:${mock.port}`, 'sk-secret');

    await adapter.chat({
      model: 'm1',
      messages: [{ role: 'system', content: 'sys' }],
      temperature: 0.1,
      maxTokens: 512,
    });

    const req = mock.lastRequest().body as Record<string, unknown>;
    expect(req.model).toBe('m1');
    expect(req.temperature).toBe(0.1);
    expect(req.max_tokens).toBe(512);
    expect(mock.lastRequest().auth).toBe('Bearer sk-secret');
  });

  it('throws on non-2xx', async () => {
    const mock = await mockOpenAI(() => ({ status: 401, json: { error: 'unauthorized' } }));
    const adapter = new OpenAICompatibleAdapter(`http://127.0.0.1:${mock.port}`);
    await expect(
      adapter.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/HTTP 401/);
  });
});

describe('OllamaAdapter', () => {
  it('calls /api/chat and parses content + usage', async () => {
    const mock = await mockOpenAI(() => ({
      json: {
        message: { role: 'assistant', content: '本地回答' },
        prompt_eval_count: 12,
        eval_count: 34,
      },
    }));
    const adapter = new OllamaAdapter(`http://127.0.0.1:${mock.port}`);

    const resp = await adapter.chat({
      model: 'qwen-local',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 256,
    });

    expect(resp.content).toBe('本地回答');
    expect(resp.usage).toEqual({ promptTokens: 12, completionTokens: 34 });

    const body = mock.lastRequest().body as Record<string, unknown>;
    expect(body.model).toBe('qwen-local');
    expect(body.stream).toBe(false);
    expect((body.options as Record<string, unknown>).num_predict).toBe(256);
  });
});

describe('streaming & structured output', () => {
  it('streams OpenAI-compatible SSE chunks', async () => {
    const port = await mockStream((res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
    const adapter = new OpenAICompatibleAdapter(`http://127.0.0.1:${port}`);
    const chunks: string[] = [];
    for await (const c of adapter.stream({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(c.content);
    }
    expect(chunks.join('')).toBe('Hello');
  });

  it('streams Ollama NDJSON chunks', async () => {
    const port = await mockStream((res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write('{"message":{"content":"A"},"done":false}\n');
      res.write('{"message":{"content":"B"},"done":true}\n');
      res.end();
    });
    const adapter = new OllamaAdapter(`http://127.0.0.1:${port}`);
    const chunks: string[] = [];
    for await (const c of adapter.stream({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(c.content);
    }
    expect(chunks.join('')).toBe('AB');
  });

  it('parses structured JSON output via chatJson', async () => {
    const mock = await mockOpenAI(() => ({
      json: { choices: [{ message: { content: '{"x":42}' } }] },
    }));
    const adapter = new OpenAICompatibleAdapter(`http://127.0.0.1:${mock.port}`);
    const result = await adapter.chatJson<{ x: number }>({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toEqual({ x: 42 });
  });
});
