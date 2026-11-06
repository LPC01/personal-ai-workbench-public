import { spawn } from 'node:child_process';

export interface WorkerRunInput {
  /** 可执行文件，默认 node。 */
  executable?: string;
  /** `-e` 内联脚本，或脚本文件路径。 */
  script: string;
  args?: string[];
  timeoutSeconds?: number;
  /** stdout/stderr 单流上限（字节），超出截断。 */
  maxOutputBytes?: number;
}

export interface WorkerRunResult {
  status: 'SUCCEEDED' | 'FAILED' | 'TIMEOUT';
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function truncate(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) {
    return value;
  }
  return value.slice(0, maxBytes) + '…[truncated]';
}

/**
 * 代码型 Worker 独立进程运行（25 设计 §10.1 L3 Tool/Worker；设计 §6.6）。
 * 与 Host 分进程，支持超时、stdout/stderr 分流 + 限长（26 SPEC §11）。
 */
export class WorkerRunner {
  async run(input: WorkerRunInput): Promise<WorkerRunResult> {
    const executable = input.executable ?? process.execPath;
    const maxOutputBytes = input.maxOutputBytes ?? 64 * 1024;
    const args = ['-e', input.script, ...(input.args ?? [])];

    return new Promise<WorkerRunResult>((resolve) => {
      const child = spawn(executable, args, { windowsHide: true });
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;

      const timer = setTimeout(
        () => {
          timedOut = true;
          child.kill('SIGKILL');
        },
        (input.timeoutSeconds ?? 30) * 1000,
      );

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ status: 'FAILED', exitCode: null, stdout, stderr: err.message });
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const status = timedOut ? 'TIMEOUT' : code === 0 ? 'SUCCEEDED' : 'FAILED';
        resolve({
          status,
          exitCode: code,
          stdout: truncate(stdout, maxOutputBytes),
          stderr: truncate(stderr, maxOutputBytes),
        });
      });
    });
  }
}
