import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { probeProvider } from '../probe.js';

const servers: Server[] = [];

function mockJson(path: string, json: unknown, status = 200): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === path) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      } else {
        res.writeHead(404);
        res.end();
      }
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

describe('probeProvider', () => {
  it('probes an Ollama provider via /api/tags', async () => {
    const port = await mockJson('/api/tags', {
      models: [{ name: 'llama3' }, { name: 'qwen-local' }],
    });
    const result = await probeProvider('ollama', `http://127.0.0.1:${port}`);
    expect(result.healthy).toBe(true);
    expect(result.models).toEqual(['llama3', 'qwen-local']);
  });

  it('probes an OpenAI-compatible provider via /models', async () => {
    const port = await mockJson('/models', { data: [{ id: 'gpt-4o-mini' }] });
    const result = await probeProvider('openai-compatible', `http://127.0.0.1:${port}`);
    expect(result.healthy).toBe(true);
    expect(result.models).toEqual(['gpt-4o-mini']);
  });

  it('returns unhealthy on connection failure', async () => {
    const result = await probeProvider('ollama', 'http://127.0.0.1:1', { timeoutMs: 1000 });
    expect(result.healthy).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns unhealthy when baseUrl is missing', async () => {
    const result = await probeProvider('ollama', null);
    expect(result.healthy).toBe(false);
    expect(result.error).toBe('未配置 baseUrl');
  });
});
