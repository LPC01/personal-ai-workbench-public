import { AppError } from '@workbench/domain';
import { healthCheckWithRetry } from './health-check.js';
import { PortAllocator } from './port-allocator.js';
import { spawnProcess, type SpawnedProcess } from './process-executor.js';

export type ServiceStatus =
  'STARTING' | 'HEALTH_CHECKING' | 'RUNNING' | 'UNHEALTHY' | 'STOPPING' | 'STOPPED' | 'FAILED';

export interface StartServiceRequest {
  projectId: string;
  commandId: string;
  executable: string;
  arguments?: string[];
  cwd?: string;
  portRange: { from: number; to: number };
  portEnvVar?: string;
  healthUrl?: string;
  healthTimeoutSeconds?: number;
}

export interface ServiceState {
  serviceId: string;
  projectId: string;
  commandId: string;
  pid: number;
  port: number;
  status: ServiceStatus;
  startedAt: string;
}

interface RunningService {
  state: ServiceState;
  proc: SpawnedProcess;
  stdoutBuffer: string;
  stderrBuffer: string;
}

/**
 * 停止时等待进程真正退出的最长时间（毫秒）。
 * 超时后仍强制收敛到终态 —— 状态**绝不**停留在 `STOPPING`（RT-03 / known-limitations #25）。
 */
const STOP_WAIT_TIMEOUT_MS = 5000;

/** 等待进程退出；超时即放弃等待（调用方负责收敛终态）。 */
async function waitForExit(proc: SpawnedProcess, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([proc.exited.catch(() => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Service 管理器（26 SPEC §9 Service 状态机 + §11）：启停、健康检查、日志。 */
export class ServiceManager {
  private readonly allocator = new PortAllocator();
  private readonly services = new Map<string, RunningService>();
  private seq = 0;

  async start(request: StartServiceRequest): Promise<ServiceState> {
    const port = await this.allocator.allocate(request.portRange.from, request.portRange.to);

    const env: Record<string, string> = {};
    if (request.portEnvVar) {
      env[request.portEnvVar] = String(port);
    }

    const proc = spawnProcess({
      executable: request.executable,
      arguments: request.arguments,
      cwd: request.cwd,
      env,
    });

    const serviceId = `svc_${this.seq++}`;
    const state: ServiceState = {
      serviceId,
      projectId: request.projectId,
      commandId: request.commandId,
      pid: proc.pid,
      port,
      status: 'STARTING',
      startedAt: new Date().toISOString(),
    };

    const running: RunningService = { state, proc, stdoutBuffer: '', stderrBuffer: '' };
    this.services.set(serviceId, running);

    proc.stdout.on('data', (chunk: Buffer) => {
      running.stdoutBuffer = (running.stdoutBuffer + chunk.toString()).slice(-8192);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      running.stderrBuffer = (running.stderrBuffer + chunk.toString()).slice(-8192);
    });

    // 健康检查
    if (request.healthUrl) {
      state.status = 'HEALTH_CHECKING';
      const url = request.healthUrl
        .replaceAll('${runtime.port}', String(port))
        .replaceAll('${port}', String(port));
      // RT-03：总宽限期由 `timeoutSeconds` 决定（未声明沿用既有默认 5 秒）。
      // 单次请求超时取 min(总窗口, 2s)，避免一次慢请求吃掉整个窗口。
      const totalWindowMs = (request.healthTimeoutSeconds ?? 5) * 1000;
      const healthy = await healthCheckWithRetry(url, totalWindowMs, Math.min(totalWindowMs, 2000));

      // 竞态防护：等待健康检查期间该实例可能已被 stop() 收敛为终态，
      // 此时不得再把状态改回 RUNNING / UNHEALTHY（否则会出现「已停止却显示运行中」）。
      if (isTerminal(state.status)) {
        return state;
      }

      if (!healthy) {
        state.status = 'UNHEALTHY';
        // 启动失败即回收：停进程树 + 释放端口，避免留下孤儿进程与悬空端口（#25）。
        // 实例本身保留在表内，供 `logs` / 状态查询回看这次失败。
        await this.dispose(running);
        return state;
      }
    }

    if (isTerminal(state.status)) {
      return state;
    }

    state.status = 'RUNNING';
    return state;
  }

  /**
   * 停止服务：**等待进程真正退出**后再收敛为 `STOPPED`。
   *
   * RT-03（修 known-limitations #20 / #26）：旧实现同步跑完，返回 `STOPPED` 时被管进程
   * 往往还活着（Windows `taskkill` 未被 await），于是停止后端口仍在响应 —— 立即重启会
   * 拿到同一端口，且健康检查会被**旧进程**的 200 蒙混通过。
   */
  async stop(serviceId: string): Promise<ServiceState> {
    const running = this.services.get(serviceId);
    if (!running) {
      throw new AppError('PROJECT_NOT_FOUND', '服务不存在', { details: { serviceId } });
    }
    if (isTerminal(running.state.status)) {
      return running.state;
    }

    running.state.status = 'STOPPING';
    try {
      running.proc.stop();
      await waitForExit(running.proc, STOP_WAIT_TIMEOUT_MS);
    } finally {
      // 无论等待成功还是超时都收敛到终态：状态绝不滞留于 STOPPING。
      this.allocator.release(running.state.port);
      running.state.status = 'STOPPED';
    }
    return running.state;
  }

  get(serviceId: string): ServiceState | undefined {
    return this.services.get(serviceId)?.state;
  }

  list(): ServiceState[] {
    return [...this.services.values()].map((s) => s.state);
  }

  logs(serviceId: string): { stdout: string; stderr: string } {
    const running = this.services.get(serviceId);
    if (!running) {
      throw new AppError('PROJECT_NOT_FOUND', '服务不存在', { details: { serviceId } });
    }
    return { stdout: running.stdoutBuffer, stderr: running.stderrBuffer };
  }

  /** 回收进程与端口（启动失败 / 停止后兜底）。幂等。 */
  private async dispose(running: RunningService): Promise<void> {
    try {
      running.proc.stop();
    } catch {
      // 进程可能已经退出，停止失败不影响状态收敛
    }
    this.allocator.release(running.state.port);
    await waitForExit(running.proc, STOP_WAIT_TIMEOUT_MS);
  }
}

/** 终态：不会再自行变化的状态。非终态实例会占用 singleton 名额。 */
export function isTerminal(status: ServiceStatus): boolean {
  return status === 'STOPPED' || status === 'FAILED';
}

/**
 * 可被再次启动的状态：除终态外，`UNHEALTHY` 也算 —— RT-03 起 `UNHEALTHY`
 * 在返回前已回收进程与端口（见 `start`），此时「再点一次启动」应当被允许，
 * 否则用户会永久卡在 409 `RUN_STATE_CONFLICT`（known-limitations #25）。
 */
export function isRestartable(status: ServiceStatus): boolean {
  return isTerminal(status) || status === 'UNHEALTHY';
}
