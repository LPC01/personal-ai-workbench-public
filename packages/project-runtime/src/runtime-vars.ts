import { isAbsolute, resolve } from 'node:path';

/**
 * 运行时平台变量（26 SPEC §5：参数只能来自静态值、平台变量或已声明参数）。
 *
 * 支持的变量：
 * - `${project.root}` —— 项目受控根（绝对路径）
 * - `${runtime.port}` / `${port}` —— 本次分配的动态端口
 */
export interface RuntimeVariableContext {
  projectRoot: string;
  port: number;
}

/** 解析单个字符串中的平台变量；无变量时原样返回。 */
export function resolveRuntimeVariables(value: string, ctx: RuntimeVariableContext): string {
  return value
    .replaceAll('${project.root}', ctx.projectRoot)
    .replaceAll('${runtime.port}', String(ctx.port))
    .replaceAll('${port}', String(ctx.port));
}

/**
 * 解析命令 cwd：未显式指定时默认 `${project.root}`；
 * 相对路径相对项目根解析，绝对路径原样返回。
 */
export function resolveCommandCwd(
  cwd: string | undefined,
  ctx: RuntimeVariableContext,
): string | undefined {
  if (!cwd) {
    return ctx.projectRoot;
  }
  const substituted = resolveRuntimeVariables(cwd, ctx);
  return isAbsolute(substituted) ? resolve(substituted) : resolve(ctx.projectRoot, substituted);
}

/** 解析参数数组中的平台变量。 */
export function resolveCommandArguments(
  args: string[] | undefined,
  ctx: RuntimeVariableContext,
): string[] | undefined {
  if (!args) {
    return undefined;
  }
  return args.map((a) => resolveRuntimeVariables(a, ctx));
}
