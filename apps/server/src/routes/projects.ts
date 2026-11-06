import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AppError } from '@workbench/domain';
import type { AuditStore } from '@workbench/persistence';
import {
  readProjectReadme,
  type CommandRegistry,
  type ProjectCatalog,
  type ServiceManager,
} from '@workbench/project-runtime';

export interface ProjectRouteDeps {
  /** Service 管理器：注销时判定并停止运行中的服务实例（未注入则不检查运行态）。 */
  manager?: ServiceManager;
  /** 审计存储（26 SPEC §16「高风险操作必须审计」）。 */
  auditStore?: AuditStore;
  /** 数据根目录：注销前把 manifest 快照写入 `<dataDir>/removed-projects/`。 */
  dataDir?: string;
}

/** 视为「占用项目」的服务状态：终态 `STOPPED` / `FAILED` 不阻塞注销。 */
const BLOCKING_SERVICE_STATUS = new Set([
  'STARTING',
  'HEALTH_CHECKING',
  'RUNNING',
  'UNHEALTHY',
  'STOPPING',
]);

function isTruthyFlag(value: unknown): boolean {
  return value === '1' || value === 'true' || value === true;
}

/**
 * 注销前把 manifest 快照落盘（安全网，便于原样重新登记）。
 * 快照是「后台保障」而非注销前提：写入失败只回传 warning，不阻断注销。
 */
function writeManifestSnapshot(
  dataDir: string | undefined,
  projectId: string,
  manifest: unknown,
): { path: string | null; error?: string } {
  if (!dataDir || manifest === undefined) return { path: null };
  try {
    const dir = join(dataDir, 'removed-projects');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = join(dir, `${projectId}-${stamp}.json`);
    writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { path: target };
  } catch (error) {
    return { path: null, error: `manifest 快照写入失败：${(error as Error).message}` };
  }
}

export function registerProjectRoutes(
  app: FastifyInstance,
  catalog: ProjectCatalog,
  commandRegistry: CommandRegistry,
  deps: ProjectRouteDeps = {},
): void {
  app.get('/api/v1/projects', async () => {
    const items = catalog.list();
    return { items, total: items.length };
  });

  app.post('/api/v1/projects/register', async (request) => {
    const manifest = request.body as unknown;
    const result = catalog.validateManifest(manifest);
    if (!result.valid) {
      throw new AppError('MANIFEST_INVALID', 'Manifest 不符合 workbench.project/v1 Schema', {
        details: { issues: result.issues },
      });
    }
    const project = catalog.register(result.value);
    // 登记项目命令（29 号 SPEC §13.2：Agent 只能调用 Manifest 已登记的命令）
    if (result.value.commands?.length) {
      commandRegistry.registerCommands(project.id, result.value.commands);
    }
    return project;
  });

  app.get('/api/v1/projects/:projectId', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const project = catalog.get(projectId);
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { id: projectId } });
    }
    return project;
  });

  /**
   * 项目自述文件（README）读取 —— **规范外扩展**：26 SPEC §10.1 Projects 端点清单无此端点。
   *
   * 只在登记根**顶层**探测候选文件名，且每个候选都经 `resolveWithinRoot` 校验
   * （符号链接逃逸的候选直接跳过）。未找到是正常状态：`{ found: false }`，不抛错。
   *
   * `?probe=1` 只回元信息（文件名 / 字节数），供列表页批量探测「有 README」计数，
   * 避免 N 个项目的正文被无谓传输。正文默认受 `README_MAX_BYTES` 截断。
   */
  app.get('/api/v1/projects/:projectId/readme', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const project = catalog.get(projectId);
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { id: projectId } });
    }
    const probe = isTruthyFlag((request.query as { probe?: unknown } | undefined)?.probe);
    const result = readProjectReadme(project.rootPath, { withContent: !probe });
    return { id: projectId, rootPath: project.rootPath, ...result };
  });

  app.post('/api/v1/projects/:projectId/validate', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const project = catalog.get(projectId);
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { id: projectId } });
    }
    const manifest = request.body as unknown;
    const result = catalog.validateManifest(manifest);
    return { valid: result.valid, issues: result.valid ? undefined : result.issues };
  });

  /**
   * 注销项目（**规范外扩展**：26 SPEC §10.1 Projects 端点清单无 delete）。
   * 语义：只注销工作台里的登记，**不删除磁盘上的项目目录与 Artifact 内容**。
   * 运行中的项目默认 409 `PROJECT_IN_USE`，显式 `?force=1` 才先停服务再注销。
   */
  app.delete('/api/v1/projects/:projectId', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const force = isTruthyFlag((request.query as { force?: unknown } | undefined)?.force);

    const project = catalog.get(projectId);
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { id: projectId } });
    }

    const blocking = (deps.manager?.list() ?? []).filter(
      (service) => service.projectId === projectId && BLOCKING_SERVICE_STATUS.has(service.status),
    );
    if (blocking.length > 0 && !force) {
      throw new AppError(
        'PROJECT_IN_USE',
        '项目有运行中的服务，请先停止，或加 ?force=1 停止并注销',
        {
          details: {
            id: projectId,
            services: blocking.map((service) => ({
              serviceId: service.serviceId,
              status: service.status,
              port: service.port,
            })),
          },
        },
      );
    }

    const stopped: string[] = [];
    const stopFailures: string[] = [];
    for (const service of blocking) {
      try {
        // RT-03：stop 改为异步（等待进程真正退出）后必须 await，
        // 否则「任一失败即中止」的判定会在进程尚未退出时就放行注销。
        await deps.manager?.stop(service.serviceId);
        stopped.push(service.serviceId);
      } catch (error) {
        stopFailures.push(`${service.serviceId}: ${(error as Error).message}`);
      }
    }
    // 原生进程没停干净就不注销：否则会留下孤儿进程 / 悬空端口
    if (stopFailures.length > 0) {
      throw new AppError('PROJECT_IN_USE', '停止运行中的服务失败，已中止注销', {
        details: { id: projectId, failures: stopFailures },
      });
    }

    const snapshot = writeManifestSnapshot(deps.dataDir, projectId, catalog.getManifest(projectId));
    const cascade = catalog.remove(projectId);
    if (!cascade) {
      throw new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { id: projectId } });
    }

    deps.auditStore?.record('system', 'project.unregister', projectId, {
      name: project.name,
      rootPath: project.rootPath,
      force,
      stoppedServices: stopped,
      cascade,
      manifestSnapshot: snapshot.path,
    });

    return {
      removed: true,
      id: projectId,
      name: project.name,
      rootPath: project.rootPath,
      cascade,
      stoppedServices: stopped,
      manifestSnapshot: snapshot.path,
      warning: snapshot.error,
    };
  });
}
