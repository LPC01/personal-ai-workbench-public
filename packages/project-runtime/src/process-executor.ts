import { spawn, type ChildProcess } from 'node:child_process';

export interface SpawnRequest {
  executable: string;
  arguments?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /**
   * 超时毫秒数（26 SPEC §5 `commands[].timeoutSeconds` 的执行侧投影）。
   * `> 0` 时生效：到点即终止该进程树并把 `timedOut` 置真；
   * 未声明或 ≤ 0 表示不限制（与 SPEC 示例中常驻服务 `timeoutSeconds: 0` 一致）。
   */
  timeoutMs?: number;
}

export interface SpawnedProcess {
  pid: number;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  exited: Promise<number | null>;
  /** 是否因执行器超时而终止（供调用方区分「超时」与「手动取消」/「非零退出」）。 */
  readonly timedOut: boolean;
  stop(): void;
}

/**
 * 进程执行器（26 SPEC §11）：spawn 记录直接 PID，stdout/stderr 分流，
 * 停止只作用于该进程树（Windows taskkill /T 等价 Job Object 约束，Unix 用进程信号）。
 *
 * 超时（26 SPEC §5）：`timeoutMs > 0` 时由执行器计时，到点终止进程树并置 `timedOut`；
 * 进程正常退出与 `stop()` 都会清理计时器，避免误判为超时。
 */
export function spawnProcess(request: SpawnRequest): SpawnedProcess {
  const child = spawn(request.executable, request.arguments ?? [], {
    cwd: request.cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: request.env ? { ...process.env, ...request.env } : process.env,
  });

  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const timeoutMs = request.timeoutMs ?? 0;
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      stopProcessTree(child);
    }, timeoutMs);
    // 计时器不应单独把宿主事件循环挂住（进程本身才是活跃句柄）。
    timer.unref();
  }

  const exited = new Promise<number | null>((resolve) => {
    child.once('close', (code) => {
      clearTimer();
      resolve(code);
    });
  });

  return {
    pid: child.pid ?? 0,
    stdout: child.stdout as NodeJS.ReadableStream,
    stderr: child.stderr as NodeJS.ReadableStream,
    exited,
    get timedOut() {
      return timedOut;
    },
    stop: () => {
      clearTimer();
      stopProcessTree(child);
    },
  };
}

export function stopProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    killer.on('error', () => {
      child.kill('SIGKILL');
    });
  } else {
    child.kill('SIGTERM');
  }
}
