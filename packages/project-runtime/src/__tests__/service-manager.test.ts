import { describe, expect, it } from 'vitest';
import { healthCheckWithRetry, httpHealthCheck } from '../health-check.js';
import { ServiceManager } from '../service-manager.js';

const NODE = process.execPath;
const HTTP_SERVER =
  "require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT))";

/** 端口是否已释放：健康检查 URL 连不上即视为已释放。 */
async function isPortFree(port: number): Promise<boolean> {
  return (await httpHealthCheck(`http://127.0.0.1:${port}/`, 500)) === false;
}

function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 轮询等待进程真正退出（Windows `taskkill` 是异步的，不能靠固定睡眠）。 */
async function waitUntilDead(pid: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('httpHealthCheck', () => {
  it('returns true for a healthy endpoint', async () => {
    const manager = new ServiceManager();
    const state = await manager.start({
      projectId: 'p1',
      commandId: 'web',
      executable: NODE,
      arguments: ['-e', HTTP_SERVER],
      portRange: { from: 20300, to: 20310 },
      portEnvVar: 'PORT',
    });
    const ok = await healthCheckWithRetry(`http://127.0.0.1:${state.port}/`, 2000, 200);
    expect(ok).toBe(true);
    await manager.stop(state.serviceId);
  });

  it('returns false for an unreachable endpoint', async () => {
    const ok = await httpHealthCheck('http://127.0.0.1:1/', 1000);
    expect(ok).toBe(false);
  });

  // RT-03：总宽限期由 timeoutSeconds 决定，而不是固定的 10 × 200ms（known-limitations #19）
  it('waits for the whole declared window before giving up', async () => {
    const manager = new ServiceManager();
    // 1.2 秒后才开始监听：旧实现（约 2 秒窗口、单次超时即占满）容易误判，
    // 新实现应等到窗口耗尽前才失败。
    const late =
      "setTimeout(()=>require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT)),1200)";
    const state = await manager.start({
      projectId: 'p-slow',
      commandId: 'web',
      executable: NODE,
      arguments: ['-e', late],
      portRange: { from: 20380, to: 20390 },
      portEnvVar: 'PORT',
      healthUrl: 'http://127.0.0.1:${port}/',
      healthTimeoutSeconds: 5,
    });
    expect(state.status).toBe('RUNNING');
    await manager.stop(state.serviceId);
  });

  it('gives up when the declared window is shorter than the boot time', async () => {
    const manager = new ServiceManager();
    const late =
      "setTimeout(()=>require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT)),3000)";
    const startedAt = Date.now();
    const state = await manager.start({
      projectId: 'p-slow2',
      commandId: 'web',
      executable: NODE,
      arguments: ['-e', late],
      portRange: { from: 20390, to: 20400 },
      portEnvVar: 'PORT',
      healthUrl: 'http://127.0.0.1:${port}/',
      healthTimeoutSeconds: 1,
    });
    expect(state.status).toBe('UNHEALTHY');
    // 窗口是 1 秒：不应等到服务真的起来（3 秒）才返回
    expect(Date.now() - startedAt).toBeLessThan(2500);
    await manager.stop(state.serviceId);
  });
});

describe('ServiceManager', () => {
  it('starts a service, health-checks to RUNNING, then stops it', async () => {
    const manager = new ServiceManager();
    const state = await manager.start({
      projectId: 'p1',
      commandId: 'web',
      executable: NODE,
      arguments: ['-e', HTTP_SERVER],
      portRange: { from: 20320, to: 20330 },
      portEnvVar: 'PORT',
      healthUrl: 'http://127.0.0.1:${port}/',
      healthTimeoutSeconds: 5,
    });
    expect(state.status).toBe('RUNNING');
    expect(state.port).toBeGreaterThanOrEqual(20320);

    await manager.stop(state.serviceId);
    expect(manager.get(state.serviceId)?.status).toBe('STOPPED');

    // RT-03：返回 STOPPED 时进程必须已真正退出、端口不再响应（#20 / #26）
    await expect(isPortFree(state.port)).resolves.toBe(true);
  });

  it('releases the port and kills the process when the health check fails', async () => {
    const manager = new ServiceManager();
    // 永不监听端口，只挂着：健康检查必然失败
    const state = await manager.start({
      projectId: 'p1',
      commandId: 'silent',
      executable: NODE,
      arguments: ['-e', 'setInterval(()=>{},1000)'],
      portRange: { from: 20410, to: 20420 },
      portEnvVar: 'PORT',
      healthUrl: 'http://127.0.0.1:${port}/',
      healthTimeoutSeconds: 1,
    });
    expect(state.status).toBe('UNHEALTHY');
    // RT-03：UNHEALTHY 必须回收进程与端口，不再留下孤儿进程 / 悬空端口（#25）
    await waitUntilDead(state.pid);
    expect(isPidAlive(state.pid)).toBe(false);
  });

  it('never leaves a service stuck in STOPPING', async () => {
    const manager = new ServiceManager();
    const state = await manager.start({
      projectId: 'p-stopping',
      commandId: 'web',
      executable: NODE,
      arguments: ['-e', HTTP_SERVER],
      portRange: { from: 20420, to: 20430 },
      portEnvVar: 'PORT',
    });
    await manager.stop(state.serviceId);
    const terminal = manager.get(state.serviceId)?.status;
    expect(terminal).not.toBe('STOPPING');
    expect(terminal).toBe('STOPPED');
  });

  it('marks UNHEALTHY when health check fails', async () => {
    const manager = new ServiceManager();
    const state = await manager.start({
      projectId: 'p1',
      commandId: 'silent',
      executable: NODE,
      arguments: ['-e', 'setInterval(()=>{},1000)'],
      portRange: { from: 20340, to: 20350 },
      portEnvVar: 'PORT',
      healthUrl: 'http://127.0.0.1:${port}/',
      healthTimeoutSeconds: 1,
    });
    expect(state.status).toBe('UNHEALTHY');
    await manager.stop(state.serviceId);
  });

  it('collects stdout logs', async () => {
    const manager = new ServiceManager();
    const state = await manager.start({
      projectId: 'p1',
      commandId: 'logger',
      executable: NODE,
      arguments: ['-e', "console.log('log-line-1'); setInterval(()=>{},1000)"],
      portRange: { from: 20360, to: 20370 },
    });
    // 轮询等待子进程 stdout 就绪（避免固定睡眠在负载下抖动）
    const deadline = Date.now() + 5000;
    let stdout = '';
    while (Date.now() < deadline) {
      stdout = manager.logs(state.serviceId).stdout;
      if (stdout.includes('log-line-1')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(stdout).toContain('log-line-1');
    await manager.stop(state.serviceId);
  });

  it('does not resurrect a service that was stopped mid health-check', async () => {
    const manager = new ServiceManager();
    // 服务 800ms 后才监听；健康检查窗口 2 秒。在等待期间从外部 stop：
    // 被杀后健康检查必然一路失败，start 会在窗口耗尽后返回 —— 此时不得把状态改回 RUNNING。
    const late =
      "setTimeout(()=>require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT)),800)";
    const [started] = await Promise.all([
      manager.start({
        projectId: 'p-race',
        commandId: 'web',
        executable: NODE,
        arguments: ['-e', late],
        portRange: { from: 20440, to: 20450 },
        portEnvVar: 'PORT',
        healthUrl: 'http://127.0.0.1:${port}/',
        healthTimeoutSeconds: 2,
      }),
      new Promise((r) => setTimeout(r, 300)).then(() => manager.stop('svc_0')),
    ]);
    // start 与 stop 作用于同一实例；最终必须是终态，不能是 RUNNING（#25 竞态）
    expect(started.status).toBe('STOPPED');
    expect(manager.get(started.serviceId)?.status).toBe('STOPPED');
    // 再等一会儿：即便服务「本该」在 800ms 起来，也不允许被复活
    await new Promise((r) => setTimeout(r, 1200));
    expect(manager.get(started.serviceId)?.status).toBe('STOPPED');
  }, 15000);
});
