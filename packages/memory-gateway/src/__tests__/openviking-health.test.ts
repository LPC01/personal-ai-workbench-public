import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { probeOpenVikingHealth } from '../openviking-adapter.js';

const servers: Server[] = [];

function startServer(routes: Record<string, [number, unknown]>): Promise<string> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const route = routes[req.url ?? '/'];
      if (!route) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(route[0], { 'Content-Type': 'application/json' });
      res.end(typeof route[1] === 'string' ? route[1] : JSON.stringify(route[1]));
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

describe('probeOpenVikingHealth（MEM-01 四态探测）', () => {
  it('/health 失败 → UNAVAILABLE', async () => {
    const url = await startServer({ '/health': [500, {}] });
    const h = await probeOpenVikingHealth(url, false);
    expect(h.status).toBe('UNAVAILABLE');
    expect(h.ok).toBe(false);
  });

  it('/ready 未就绪 → DEGRADED', async () => {
    const url = await startServer({
      '/health': [200, { status: 'ok' }],
      '/ready': [200, { status: 'degraded' }],
    });
    const h = await probeOpenVikingHealth(url, false);
    expect(h.status).toBe('DEGRADED');
    expect(h.ok).toBe(false);
  });

  it('就绪 + 只读 → READY_READONLY', async () => {
    const url = await startServer({
      '/health': [200, { status: 'ok' }],
      '/ready': [200, { status: 'ready' }],
    });
    const h = await probeOpenVikingHealth(url, true);
    expect(h.status).toBe('READY_READONLY');
    expect(h.ok).toBe(true);
  });

  it('就绪 + 读写 → READY_READWRITE', async () => {
    const url = await startServer({
      '/health': [200, { status: 'ok' }],
      '/ready': [200, { status: 'ready' }],
    });
    const h = await probeOpenVikingHealth(url, false);
    expect(h.status).toBe('READY_READWRITE');
    expect(h.ok).toBe(true);
  });
});
