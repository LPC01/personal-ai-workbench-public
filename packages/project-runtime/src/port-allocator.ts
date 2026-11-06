import { createServer } from 'node:net';
import { AppError } from '@workbench/domain';

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * 动态端口分配器（26 SPEC §11）：在 from–to 范围内找可用端口，分配后加内存锁防止重复。
 * 持久化锁（写入 Run）属 P2。
 */
export class PortAllocator {
  private readonly allocated = new Set<number>();

  async allocate(from: number, to: number): Promise<number> {
    for (let port = from; port <= to; port++) {
      if (this.allocated.has(port)) {
        continue;
      }
      if (await isPortAvailable(port)) {
        this.allocated.add(port);
        return port;
      }
    }
    throw new AppError('PORT_UNAVAILABLE', '范围内无可用端口', { details: { from, to } });
  }

  release(port: number): void {
    this.allocated.delete(port);
  }

  has(port: number): boolean {
    return this.allocated.has(port);
  }
}
