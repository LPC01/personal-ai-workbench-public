import type { ProjectManifest } from '@workbench/contracts';
import { AppError } from '@workbench/domain';
import {
  HarnessToolRegistry,
  type HarnessTool,
  type HarnessToolScope,
} from '@workbench/execution-gateway';
import type {
  ApprovalStore,
  ArtifactRecord,
  ArtifactStore,
  RunRecord,
  RunStore,
} from '@workbench/persistence';
import type { ProjectCatalog } from '@workbench/project-runtime';
import type { JobRunner } from './job-runner.js';

/**
 * Harness 工具（26 SPEC §13）：只读 + 受控写。
 *
 * 安全约束（§13 + §16）：不返回主机绝对路径；工具作用域约束（只能触达当前 Run 绑定的项目/运行）；
 * 参数/返回在事件流边界脱敏（SEC-004，由 HarnessToolRegistry.redactSecrets 兜底）。
 */

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError('COMMAND_ARGUMENT_INVALID', `缺少参数 ${key}`, { details: { key } });
  }
  return value;
}

/** 约束项目作用域：scope 有 projectId 时必须一致，否则越界。 */
function assertProjectScope(scope: HarnessToolScope | undefined, projectId: string): void {
  if (scope && scope.projectId !== null && scope.projectId !== projectId) {
    throw new AppError('EXTENSION_PERMISSION_DENIED', '项目越出工具作用域', {
      details: { projectId, scopeProjectId: scope.projectId },
    });
  }
}

/** 约束 Run 作用域：scope 有 runId 时必须一致，否则越界。 */
function assertRunScope(scope: HarnessToolScope | undefined, runId: string): void {
  if (scope && scope.runId !== null && scope.runId !== runId) {
    throw new AppError('EXTENSION_PERMISSION_DENIED', 'Run 越出工具作用域', {
      details: { runId, scopeRunId: scope.runId },
    });
  }
}

/** 去路径的 Artifact 元数据（不含 storage_ref）。 */
function safeArtifact(a: ArtifactRecord): Record<string, unknown> {
  return {
    id: a.id,
    runId: a.runId,
    projectId: a.projectId,
    kind: a.kind,
    logicalName: a.logicalName,
    sha256: a.sha256,
    mediaType: a.mediaType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt,
  };
}

/** 去路径/去输入/去模型绑定的 Run 状态（不含 input/modelBinding）。 */
function safeRun(r: RunRecord): Record<string, unknown> {
  return {
    id: r.id,
    projectId: r.projectId,
    kind: r.kind,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    exitCode: r.exitCode,
    errorCode: r.errorCode,
    createdAt: r.createdAt,
  };
}

function projectDescribe(catalog: ProjectCatalog): HarnessTool {
  return {
    toolId: 'project.describe',
    async execute(args, _policy, scope) {
      const projectId = requireString(args, 'projectId');
      assertProjectScope(scope, projectId);
      const manifest: ProjectManifest | undefined = catalog.getManifest(projectId);
      if (!manifest) {
        throw new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { projectId } });
      }
      // 仅返回语义信息，不返回 runtime.root 等主机绝对路径
      return {
        id: manifest.project.id,
        name: manifest.project.name,
        description: manifest.project.description ?? null,
        commandCount: manifest.commands?.length ?? 0,
      };
    },
  };
}

function projectCommandsList(catalog: ProjectCatalog): HarnessTool {
  return {
    toolId: 'project.commands.list',
    async execute(args, _policy, scope) {
      const projectId = requireString(args, 'projectId');
      assertProjectScope(scope, projectId);
      const manifest = catalog.getManifest(projectId);
      if (!manifest) {
        throw new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { projectId } });
      }
      // 不返回 executable/arguments/cwd（可能含主机路径）
      const items = (manifest.commands ?? []).map((c) => ({ id: c.id, type: c.type }));
      return { items, total: items.length };
    },
  };
}

function runStatus(store: RunStore): HarnessTool {
  return {
    toolId: 'run.status',
    async execute(args, _policy, scope) {
      const runId = requireString(args, 'runId');
      assertRunScope(scope, runId);
      const run = store.getRun(runId);
      if (!run) {
        throw new AppError('RUN_NOT_FOUND', 'Run 不存在', { details: { runId } });
      }
      return safeRun(run);
    },
  };
}

function runEvents(store: RunStore): HarnessTool {
  return {
    toolId: 'run.events',
    async execute(args, _policy, scope) {
      const runId = requireString(args, 'runId');
      assertRunScope(scope, runId);
      if (!store.getRun(runId)) {
        throw new AppError('RUN_NOT_FOUND', 'Run 不存在', { details: { runId } });
      }
      const after = typeof args.after === 'number' && args.after > 0 ? args.after : 0;
      const items = after > 0 ? store.listRunEventsAfter(runId, after) : store.listRunEvents(runId);
      return { items, total: items.length };
    },
  };
}

function artifactList(store: ArtifactStore): HarnessTool {
  return {
    toolId: 'artifact.list',
    async execute(args, _policy, scope) {
      const runId = requireString(args, 'runId');
      assertRunScope(scope, runId);
      const items = store.listByRun(runId).map(safeArtifact);
      return { items, total: items.length };
    },
  };
}

function artifactRead(store: ArtifactStore): HarnessTool {
  return {
    toolId: 'artifact.read',
    async execute(args, _policy, scope) {
      const artifactId = requireString(args, 'artifactId');
      const artifact = store.get(artifactId);
      if (!artifact) {
        throw new AppError('ARTIFACT_NOT_FOUND', 'Artifact 不存在', { details: { artifactId } });
      }
      assertRunScope(scope, artifact.runId);
      const content = store.readContent(artifactId);
      return {
        ...safeArtifact(artifact),
        content: content ? content.toString('utf8') : null,
      };
    },
  };
}

/** 构建只读工具注册表（项目/运行/成果）。 */
export function buildReadOnlyToolRegistry(
  catalog: ProjectCatalog,
  runStore: RunStore,
  artifactStore: ArtifactStore,
): HarnessToolRegistry {
  const registry = new HarnessToolRegistry();
  registry.register(projectDescribe(catalog));
  registry.register(projectCommandsList(catalog));
  registry.register(runStatus(runStore));
  registry.register(runEvents(runStore));
  registry.register(artifactList(artifactStore));
  registry.register(artifactRead(artifactStore));
  return registry;
}

/** 受控命令执行（26 SPEC §13）：校验命令已登记 + ToolPolicy 约束的 commandId 白名单 + 作用域。 */
function projectCommandRun(catalog: ProjectCatalog, jobRunner: JobRunner): HarnessTool {
  return {
    toolId: 'project.command.run',
    async execute(args, policy, scope) {
      const projectId = requireString(args, 'projectId');
      assertProjectScope(scope, projectId);
      const commandId = requireString(args, 'commandId');
      const manifest = catalog.getManifest(projectId);
      if (!manifest) {
        throw new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { projectId } });
      }
      const command = (manifest.commands ?? []).find((c) => c.id === commandId);
      if (!command) {
        throw new AppError('COMMAND_NOT_REGISTERED', '命令未登记', {
          details: { projectId, commandId },
        });
      }
      // 受控：ToolPolicy.constraints 里的命令白名单
      const constraints = policy.constraints['project.command.run'] as
        { commandIds?: string[] } | undefined;
      if (constraints?.commandIds && !constraints.commandIds.includes(commandId)) {
        throw new AppError('EXTENSION_PERMISSION_DENIED', `命令 ${commandId} 不在白名单`, {
          details: { commandId },
        });
      }
      const run = await jobRunner.start({ projectId, command, manifest });
      return { runId: run.id, status: run.status };
    },
  };
}

function runCancel(jobRunner: JobRunner): HarnessTool {
  return {
    toolId: 'run.cancel',
    async execute(args, _policy, scope) {
      const runId = requireString(args, 'runId');
      assertRunScope(scope, runId);
      const run = jobRunner.cancel(runId);
      return { runId: run.id, status: run.status };
    },
  };
}

function artifactPublish(store: ArtifactStore): HarnessTool {
  return {
    toolId: 'artifact.publish',
    async execute(args, _policy, scope) {
      const runId = requireString(args, 'runId');
      assertRunScope(scope, runId);
      const kind = requireString(args, 'kind');
      const logicalName = requireString(args, 'logicalName');
      const content = args.content;
      if (typeof content !== 'string') {
        throw new AppError('COMMAND_ARGUMENT_INVALID', 'content 需为字符串', {
          details: { key: 'content' },
        });
      }
      const mediaType = typeof args.mediaType === 'string' ? args.mediaType : undefined;
      const artifact = store.create({
        runId,
        kind,
        logicalName,
        content: Buffer.from(content, 'utf8'),
        mediaType,
      });
      return safeArtifact(artifact);
    },
  };
}

function approvalRequest(store: ApprovalStore): HarnessTool {
  return {
    toolId: 'approval.request',
    async execute(args) {
      const actionType = requireString(args, 'actionType');
      const targetRef = requireString(args, 'targetRef');
      const request = (args.request ?? {}) as Record<string, unknown>;
      const approval = store.create({
        actionType,
        targetRef,
        request,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      return { id: approval.id, status: approval.status };
    },
  };
}

function approvalStatus(store: ApprovalStore): HarnessTool {
  return {
    toolId: 'approval.status',
    async execute(args) {
      const approvalId = requireString(args, 'approvalId');
      const approval = store.get(approvalId);
      if (!approval) {
        throw new AppError('APPROVAL_NOT_FOUND', '审批不存在', { details: { approvalId } });
      }
      return {
        id: approval.id,
        actionType: approval.actionType,
        targetRef: approval.targetRef,
        status: approval.status,
        decidedAt: approval.decidedAt,
      };
    },
  };
}

/** 构建完整 Harness 工具注册表（只读 + 受控写）。 */
export function buildHarnessToolRegistry(
  catalog: ProjectCatalog,
  runStore: RunStore,
  artifactStore: ArtifactStore,
  jobRunner: JobRunner,
  approvalStore: ApprovalStore,
): HarnessToolRegistry {
  const registry = buildReadOnlyToolRegistry(catalog, runStore, artifactStore);
  registry.register(projectCommandRun(catalog, jobRunner));
  registry.register(runCancel(jobRunner));
  registry.register(artifactPublish(artifactStore));
  registry.register(approvalRequest(approvalStore));
  registry.register(approvalStatus(approvalStore));
  return registry;
}
