import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@workbench/domain';
import { PortAllocator } from '../port-allocator.js';

const servers: Server[] = [];

function occupy(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      servers.push(server);
      resolve();
    });
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
        }),
    ),
  );
});

describe('PortAllocator', () => {
  it('allocates a port within the range', async () => {
    const allocator = new PortAllocator();
    const port = await allocator.allocate(20000, 20010);
    expect(port).toBeGreaterThanOrEqual(20000);
    expect(port).toBeLessThanOrEqual(20010);
  });

  it('does not allocate the same port twice (lock)', async () => {
    const allocator = new PortAllocator();
    const a = await allocator.allocate(20020, 20030);
    const b = await allocator.allocate(20020, 20030);
    expect(a).not.toBe(b);
  });

  it('reuses a released port', async () => {
    const allocator = new PortAllocator();
    const port = await allocator.allocate(20040, 20050);
    allocator.release(port);
    const again = await allocator.allocate(20040, 20050);
    expect(again).toBe(port);
  });

  it('throws PORT_UNAVAILABLE when the range is exhausted', async () => {
    const port = 20060;
    await occupy(port);
    const allocator = new PortAllocator();
    await expect(allocator.allocate(port, port)).rejects.toBeInstanceOf(AppError);
    await expect(allocator.allocate(port, port)).rejects.toMatchObject({
      code: 'PORT_UNAVAILABLE',
    });
  });
});
