import { basename, isAbsolute } from 'node:path';
import { AppError } from '@workbench/domain';
import { resolveWithinRoot } from './path-resolver.js';

/**
 * 默认允许的具体程序（26 SPEC §5：`executable` 必须是 Registry 允许的具体程序）。
 * 归一化后比较：取 basename、去 `.exe`、小写。刻意**不含 shell**（cmd/bash/sh），
 * 与 §5「禁止 shell: true、管道、重定向、命令拼接」一致。
 */
export const DEFAULT_ALLOWED_EXECUTABLES: readonly string[] = [
  'node',
  'npm',
  'npx',
  'pnpm',
  'python',
  'python3',
  'powershell',
  'pwsh',
];

export interface ExecutablePolicy {
  /** 归一化后的允许程序名集合。 */
  allowed: ReadonlySet<string>;
}

/** 归一化程序名：basename → 去 `.exe` → 小写。 */
export function normalizeExecutableName(executable: string): string {
  const base = basename(executable).toLowerCase();
  return base.endsWith('.exe') ? base.slice(0, -4) : base;
}

/**
 * 解析策略：默认集合 + `WB_ALLOWED_EXECUTABLES`（逗号分隔）扩展。
 * 环境变量可放宽清单，无需改代码即可支持新程序。
 */
export function resolveExecutablePolicy(env: Record<string, string | undefined>): ExecutablePolicy {
  const extra = (env.WB_ALLOWED_EXECUTABLES ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map(normalizeExecutableName);
  return { allowed: new Set([...DEFAULT_ALLOWED_EXECUTABLES, ...extra]) };
}

/**
 * 判断可执行程序是否被允许：basename 命中清单，或绝对路径经真实路径解析后
 * 落在受控根内（项目自带二进制）。空串、含空字节、以及带路径分隔符却落在
 * 根外的相对/绝对路径一律拒绝。
 */
export function isExecutableAllowed(
  executable: string,
  policy: ExecutablePolicy,
  controlledRoot?: string,
): boolean {
  if (executable.length === 0 || executable.includes('\0')) {
    return false;
  }
  if (policy.allowed.has(normalizeExecutableName(executable))) {
    return true;
  }
  if (controlledRoot !== undefined && isAbsolute(executable)) {
    try {
      resolveWithinRoot(controlledRoot, executable);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** 校验可执行程序；不在允许范围时抛 COMMAND_NOT_REGISTERED（26 SPEC §17，404）。 */
export function assertExecutableAllowed(
  executable: string,
  policy: ExecutablePolicy,
  controlledRoot?: string,
): void {
  if (!isExecutableAllowed(executable, policy, controlledRoot)) {
    throw new AppError('COMMAND_NOT_REGISTERED', '可执行程序不在允许清单内', {
      details: { executable },
    });
  }
}
