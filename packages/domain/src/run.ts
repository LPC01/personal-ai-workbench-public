import { AppError } from './errors.js';

/**
 * Run 状态机（26 SPEC §9.1）。
 *
 * 允许转换：
 * ```
 * CREATED→VALIDATING
 * VALIDATING→QUEUED|FAILED
 * QUEUED→STARTING|CANCELLED
 * STARTING→RUNNING|FAILED|UNKNOWN
 * RUNNING→WAITING_USER|CANCELLING|SUCCEEDED|FAILED|UNKNOWN
 * WAITING_USER→RUNNING|CANCELLING|FAILED
 * CANCELLING→CANCELLED|FAILED|UNKNOWN
 * UNKNOWN→RECONCILING
 * RECONCILING→RUNNING|SUCCEEDED|FAILED|CANCELLED
 * ```
 *
 * 终态：`SUCCEEDED`、`FAILED`、`CANCELLED`。终态不得返回非终态。
 */
export type RunStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'QUEUED'
  | 'STARTING'
  | 'RUNNING'
  | 'WAITING_USER'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'RECONCILING';

/** Run 初始状态。 */
export const RUN_INITIAL_STATUS: RunStatus = 'CREATED';

/** 终态集合。 */
export const RUN_TERMINAL_STATUSES: readonly RunStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];

/** §9.1 允许转换表（终态无出边）。 */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  CREATED: ['VALIDATING'],
  VALIDATING: ['QUEUED', 'FAILED'],
  QUEUED: ['STARTING', 'CANCELLED'],
  STARTING: ['RUNNING', 'FAILED', 'UNKNOWN'],
  RUNNING: ['WAITING_USER', 'CANCELLING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'],
  WAITING_USER: ['RUNNING', 'CANCELLING', 'FAILED'],
  CANCELLING: ['CANCELLED', 'FAILED', 'UNKNOWN'],
  UNKNOWN: ['RECONCILING'],
  RECONCILING: ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
  CANCELLED: [],
  SUCCEEDED: [],
  FAILED: [],
};

/** 是否为终态。 */
export function isTerminalRunStatus(status: RunStatus): boolean {
  return (RUN_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** 从 `from` 到 `to` 是否为合法转换。 */
export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  const allowed = RUN_TRANSITIONS[from];
  return allowed !== undefined && (allowed as readonly string[]).includes(to);
}

/** 断言合法转换，非法时抛 `RUN_STATE_CONFLICT`。 */
export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new AppError('RUN_STATE_CONFLICT', `非法 Run 状态转换: ${from} -> ${to}`, {
      details: { from, to },
    });
  }
}

/**
 * 取消操作的目标状态（26 SPEC §10.2 `POST /runs/{runId}/cancel`）：
 * - `QUEUED` → `CANCELLED`（尚未启动，直接取消）
 * - `RUNNING` / `WAITING_USER` → `CANCELLING`
 * - `CANCELLING` → `CANCELLING`（幂等，已在取消中）
 * - 终态 / `UNKNOWN` / `RECONCILING` 等 → `null`（不可取消）
 */
export function resolveCancelStatus(status: RunStatus): RunStatus | null {
  switch (status) {
    case 'QUEUED':
      return 'CANCELLED';
    case 'RUNNING':
    case 'WAITING_USER':
    case 'CANCELLING':
      return 'CANCELLING';
    default:
      return null;
  }
}
