import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AppError } from '@workbench/domain';
import {
  assertExecutableAllowed,
  isRestartable,
  isTerminal,
  resolveCommandArguments,
  resolveCommandCwd,
  resolveExecutablePolicy,
  resolveWithinRoot,
  type ExecutablePolicy,
  type ProjectCatalog,
  type ServiceManager,
  type ServiceState,
} from '@workbench/project-runtime';

/** 项目存在但从未启动过时的稳定空态（与 `logs` 端点同构，查询类端点不产生 404 噪音）。 */
const EMPTY_RUNTIME: ServiceState = {
  serviceId: '',
  projectId: '',
  commandId: '',
  pid: 0,
  port: 0,
  status: 'STOPPED',
  startedAt: '',
};

export function registerRuntimeRoutes(
  app: FastifyInstance,
  catalog: ProjectCatalog,
  manager: ServiceManager,
  execPolicy: ExecutablePolicy = resolveExecutablePolicy(process.env),
): void {
  app.post('/api/v1/projects/:projectId/runtime/start', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const manifest = catalog.getManifest(projectId);
    if (!manifest) {
      throw new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { id: projectId } });
    }

    const startCommandId = manifest.webUI?.startCommandId;
    const command =
      manifest.commands?.find((c) => c.id === startCommandId) ??
      manifest.commands?.find((c) => c.type === 'service');
    if (!command) {
      throw new AppError('COMMAND_NOT_REGISTERED', '未找到启动命令', { details: { projectId } });
    }

    // 并发约束（26 SPEC §5 `concurrency: singleton`）：同项目 + 同命令已有非终态服务实例时拒绝，
    // 防止重复点击「启动」拉起第二个常驻进程（占用新端口）。未声明 / `parallel` = 不限制。
    if (command.concurrency === 'singleton') {
      // RT-03：`UNHEALTHY` 也算「可重启」——自 RT-03 起它在返回前已回收进程与端口，
      // 若继续当成非终态占用名额，用户会永久卡在 409「已有运行中的实例」而无法自愈。
      const existing = manager
        .list()
        .find(
          (s) =>
            s.projectId === projectId &&
            s.commandId === command.id &&
            !isRestartable(s.status as ServiceState['status']),
        );
      if (existing) {
        throw new AppError(
          'RUN_STATE_CONFLICT',
          `命令 ${command.id} 声明 concurrency: singleton，已有运行中的实例`,
          { details: { projectId, commandId: command.id, serviceId: existing.serviceId } },
        );
      }
    }

    const port = manifest.runtime.port ?? { strategy: 'dynamic', from: 8100, to: 8199 };

    const projectRoot = resolve(manifest.runtime.root);
    const ctx = { projectRoot, port: 0 };
    // 受控根约束 + 可执行白名单（26 SPEC §5 / §16 SEC-002）：越界或未登记程序直接 4xx。
    assertExecutableAllowed(command.executable, execPolicy, projectRoot);
    const cwd = resolveWithinRoot(projectRoot, resolveCommandCwd(command.cwd, ctx) ?? projectRoot);
    const args = resolveCommandArguments(command.arguments, ctx) ?? [];

    return manager.start({
      projectId,
      commandId: command.id,
      executable: command.executable,
      arguments: args,
      cwd,
      portRange: { from: port.from, to: port.to },
      portEnvVar: port.environmentVariable,
      healthUrl: manifest.webUI?.healthCheck?.url,
      healthTimeoutSeconds: manifest.webUI?.healthCheck?.timeoutSeconds,
    });
  });

  app.post('/api/v1/projects/:projectId/runtime/stop', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const service = manager
      .list()
      .find((s) => s.projectId === projectId && !isTerminal(s.status as ServiceState['status']));
    if (!service) {
      throw new AppError('PROJECT_NOT_FOUND', '无运行中的服务', { details: { projectId } });
    }
    // RT-03：await —— 返回时进程已真正退出、端口已释放，不会再出现「已 STOPPED 但端口仍在响应」。
    return manager.stop(service.serviceId);
  });

  // RT-03 新增：查询项目**当前**运行时状态。此前只有 start / stop 的响应里能拿到状态，
  // 前端只能缓存最后一次快照 —— 切到别的视图再回来显示的是陈旧值，与服务端真实状态可能不符
  // （known-limitations #25）。本端点让「状态」成为可随时查询的事实源，非只读、无副作用。
  app.get('/api/v1/projects/:projectId/runtime', async (request) => {
    const { projectId } = request.params as { projectId: string };
    if (!catalog.get(projectId)) {
      throw new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { id: projectId } });
    }
    const all = manager.list().filter((s) => s.projectId === projectId);
    // 优先返回活跃（非终态）实例；没有则回看最近一次启动的结果（如 UNHEALTHY），
    // 便于用户判断「上次到底是没起来还是起来了又停了」。
    const active = all.find((s) => !isTerminal(s.status as ServiceState['status']));
    if (active) return active;
    const last = all
      .slice()
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .at(0);
    return last ?? { ...EMPTY_RUNTIME, projectId };
  });

  app.get('/api/v1/projects/:projectId/logs', async (request) => {
    const { projectId } = request.params as { projectId: string };
    if (!catalog.get(projectId)) {
      throw new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { id: projectId } });
    }
    const service = manager.list().find((s) => s.projectId === projectId);
    // 项目存在但当前无服务实例（未启动）：返回空日志而非 404。
    // 「查看日志」是查询类端点，未运行时是稳定空态，不应产生必然的 404 噪音。
    if (!service) return { stdout: '', stderr: '' };
    return manager.logs(service.serviceId);
  });
}
