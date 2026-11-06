import { resolve } from 'node:path';
import type { ProjectCommand, ProjectManifest } from '@workbench/contracts';
import type { RunRecord, RunStore } from '@workbench/persistence';
import { AppError, type RunStatus } from '@workbench/domain';
import {
  assertExecutableAllowed,
  resolveCommandArguments,
  resolveCommandCwd,
  resolveExecutablePolicy,
  resolveWithinRoot,
  spawnProcess,
  validateCommandArguments,
  type ExecutablePolicy,
  type RunStreamHub,
  type SpawnedProcess,
} from '@workbench/project-runtime';

export interface StartJobInput {
  projectId: string;
  command: ProjectCommand;
  manifest: ProjectManifest;
}

interface TransitionOptions {
  exitCode?: number;
  errorCode?: string;
}

/**
 * 把 manifest 的 `commands[].timeoutSeconds`（26 SPEC §5）转成 `spawnProcess` 的毫秒超时。
 * 未声明、非有限数或 ≤ 0 一律视为「不限制」（返回 undefined），与 SPEC 示例中
 * 常驻服务写 `timeoutSeconds: 0` 的语义一致。
 */
function resolveCommandTimeoutMs(timeoutSeconds: number | undefined): number | undefined {
  if (
    typeof timeoutSeconds !== 'number' ||
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds <= 0
  ) {
    return undefined;
  }
  return Math.floor(timeoutSeconds * 1000);
}

/**
 * Job 执行器（26 SPEC §9.1 + §11）：创建 Run → 状态机推进 → spawn 真实进程 →
 * 事件流 → 终态（SUCCEEDED / FAILED / CANCELLED）。取消时杀进程树。
 */
export class JobRunner {
  private readonly running = new Map<string, SpawnedProcess>();

  constructor(
    private readonly runStore: RunStore,
    private readonly hub: RunStreamHub,
    private readonly execPolicy: ExecutablePolicy = resolveExecutablePolicy(process.env),
  ) {}

  /** 创建并启动一个 job Run，返回时状态为 RUNNING（校验失败则为 FAILED）；收尾在后台继续。 */
  async start(input: StartJobInput): Promise<RunRecord> {
    const { projectId, command, manifest } = input;

    const run = this.runStore.createRun({
      projectId,
      kind: 'job',
      commandRef: command.id,
      input: { commandId: command.id },
    });
    this.emit(run.id, 'state', { status: 'CREATED' });

    this.transition(run.id, 'VALIDATING');

    let args: string[] | undefined;
    try {
      args = validateCommandArguments(command.arguments);
    } catch {
      this.transition(run.id, 'FAILED', { errorCode: 'COMMAND_ARGUMENT_INVALID' });
      return this.runStore.getRun(run.id) as RunRecord;
    }

    // 受控根约束 + 可执行白名单（26 SPEC §5 / §16 SEC-002）。
    // 校验失败不 spawn，Run 转 FAILED 并带对应错误码（PATH_OUTSIDE_ROOT / COMMAND_NOT_REGISTERED）。
    let cwd: string;
    let resolvedArgs: string[];
    try {
      const projectRoot = resolve(manifest.runtime.root);
      const ctx = { projectRoot, port: 0 };
      assertExecutableAllowed(command.executable, this.execPolicy, projectRoot);
      cwd = resolveWithinRoot(projectRoot, resolveCommandCwd(command.cwd, ctx) ?? projectRoot);
      resolvedArgs = resolveCommandArguments(args, ctx) ?? [];
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'PATH_OUTSIDE_ROOT';
      this.transition(run.id, 'FAILED', { errorCode: code });
      return this.runStore.getRun(run.id) as RunRecord;
    }

    // 并发约束（26 SPEC §5 `concurrency: singleton`）：同项目 + 同命令已有进行中的 Run 时拒绝。
    // 实现决策：未声明 / `parallel` = 不限制（保持既有行为）；拒绝以 FAILED + RUN_STATE_CONFLICT
    // 记录（与同模块其它策略拒绝一致，保留审计轨迹）。
    if (command.concurrency === 'singleton') {
      const active = this.runStore
        .listActiveRunsByCommand(projectId, command.id)
        .filter((existing) => existing.id !== run.id);
      if (active.length > 0) {
        this.transition(run.id, 'FAILED', { errorCode: 'RUN_STATE_CONFLICT' });
        this.emit(run.id, 'state', {
          to: 'FAILED',
          errorCode: 'RUN_STATE_CONFLICT',
          reason: 'CONCURRENCY_SINGLETON',
          activeRunId: active[0]?.id ?? null,
        });
        return this.runStore.getRun(run.id) as RunRecord;
      }
    }

    this.transition(run.id, 'QUEUED');
    this.transition(run.id, 'STARTING');
    const proc = spawnProcess({
      executable: command.executable,
      arguments: resolvedArgs,
      cwd,
      timeoutMs: resolveCommandTimeoutMs(command.timeoutSeconds),
    });
    this.running.set(run.id, proc);

    this.transition(run.id, 'RUNNING');
    void this.finalize(run.id, proc);

    return this.runStore.getRun(run.id) as RunRecord;
  }

  /** 取消：QUEUED→CANCELLED；RUNNING→CANCELLING 并杀进程树（收尾转 CANCELLED）。 */
  cancel(runId: string): RunRecord {
    const run = this.runStore.cancelRun(runId);
    const proc = this.running.get(runId);
    if (proc && run.status === 'CANCELLING') {
      proc.stop();
    }
    return this.runStore.getRun(runId) as RunRecord;
  }

  private async finalize(runId: string, proc: SpawnedProcess): Promise<void> {
    proc.stdout.on('data', (chunk: Buffer) => {
      this.emit(runId, 'log', { stream: 'stdout', data: chunk.toString() });
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      this.emit(runId, 'log', { stream: 'stderr', data: chunk.toString() });
    });

    const code = await proc.exited;
    this.running.delete(runId);

    const current = this.runStore.getRun(runId);
    if (!current) {
      return;
    }
    if (current.status === 'CANCELLING') {
      this.transition(runId, 'CANCELLED');
    } else if (proc.timedOut) {
      // 命令超时（26 SPEC §5）：复用既有 RunStore.timeoutRun（§9.1，error_code = TIMEOUT），
      // 与手动取消区分开。
      this.runStore.timeoutRun(runId);
      this.emit(runId, 'state', { from: current.status, to: 'FAILED', errorCode: 'TIMEOUT' });
    } else if (code === 0) {
      this.transition(runId, 'SUCCEEDED', { exitCode: 0 });
    } else {
      this.transition(runId, 'FAILED', { exitCode: code ?? -1, errorCode: 'NON_ZERO_EXIT' });
    }
  }

  private transition(runId: string, to: RunStatus, opts: TransitionOptions = {}): void {
    const before = this.runStore.getRun(runId)?.status;
    this.runStore.transitionRun(runId, to, opts);
    this.emit(runId, 'state', { from: before, to });
  }

  private emit(runId: string, eventType: string, payload: Record<string, unknown>): void {
    const event = this.runStore.appendRunEvent(runId, eventType, payload);
    this.hub.publish(runId, event);
  }
}
