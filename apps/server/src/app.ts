import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { AppError, newRequestId, toErrorResponse } from '@workbench/domain';
import {
  InMemoryCredentialStore,
  WindowsCredentialStore,
  type CredentialStore,
} from '@workbench/model-gateway';
import type { MemoryProvider } from '@workbench/contracts';
import {
  ArtifactStore,
  ApprovalStore,
  AssistantDraftStore,
  AuditStore,
  DraftVerificationStore,
  ExtensionStore,
  HarnessProfileStore,
  HarnessSessionStore,
  IssueStore,
  MemoryCenterStore,
  migrations,
  ModelGatewayStore,
  ModelUsageStore,
  RoomStore,
  RunStore,
  StudioStore,
  AgentProfileStore,
  AgentSessionStore,
  DecisionStore,
} from '@workbench/persistence';
import {
  FallbackMemoryProvider,
  InMemoryMemoryProvider,
  MemoryRecallService,
  MemoryReviewService,
  MemoryService,
  OpenVikingAdapter,
} from '@workbench/memory-gateway';
import {
  ProjectCatalog,
  CommandRegistry,
  resolveExecutablePolicy,
  resolveRegistrationRoot,
  RunStreamHub,
  ServiceManager,
} from '@workbench/project-runtime';
import { RoomOrchestrator } from '@workbench/room-orchestrator';
import { RoomAutoTurnService } from './room-auto-turn-service.js';
import { createOrchestrationPorts } from './orchestration-ports.js';
import { registerOrchestrationRoutes } from './routes/orchestration.js';
import { RoomService } from './room-service.js';
import { AgentProfileService } from './agent-profile-service.js';
import { AgentRunService } from './agent-run-service.js';
import { buildHarnessToolRegistry } from './harness-tools.js';
import { ReviewService } from './review-service.js';
import { ProjectService } from './project-service.js';
import { SddService } from './sdd-service.js';
import { MemoryRefinementService } from './memory-refinement-service.js';
import { JobRunner } from './job-runner.js';
import { buildAppInfo } from './app-info.js';
import { BackupService } from './backup-service.js';
import { CloudEgressGate } from './cloud-egress.js';
import { DiagnosticsService } from './diagnostics-service.js';
import { resolveDataDir, type DataDirConfig } from './data-dir.js';
import { RestoreService } from './restore-service.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerArtifactRoutes } from './routes/artifacts.js';
import { registerAppInfoRoutes } from './routes/app-info.js';
import { registerAssistantRoutes } from './routes/assistant.js';
import { registerBackupRoutes } from './routes/backup.js';
import { registerCredentialRoutes } from './routes/credentials.js';
import { registerDiagnosticsRoutes } from './routes/diagnostics.js';
import { registerDraftVerificationRoutes } from './routes/draft-verification.js';
import { registerExtensionRoutes } from './routes/extensions.js';
import { registerHarnessRoutes } from './routes/harness.js';
import { registerIssueRoutes } from './routes/issues.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerModelRoutes } from './routes/models.js';
import { registerOverviewRoutes } from './routes/overview.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerRestoreRoutes } from './routes/restore.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerRoomRoutes } from './routes/rooms.js';
import { registerAgentProfileRoutes } from './routes/agent-profiles.js';
import { registerAgentRunRoutes } from './routes/agent-runs.js';
import { registerReviewRoutes } from './routes/review.js';
import { registerRoomProjectRoutes } from './routes/room-projects.js';
import { registerSddRoutes } from './routes/sdd.js';
import { registerRefinementRoutes } from './routes/refinement.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerRuntimeRoutes } from './routes/runtime.js';
import { registerStudioRoutes } from './routes/studio.js';
import { registerUsageRoutes } from './routes/usage.js';

export interface BuildAppOptions {
  hub?: RunStreamHub;
  artifactsRoot?: string;
  credentialStore?: CredentialStore;
  dataDirConfig?: DataDirConfig;
  /**
   * 登记根（26 SPEC §5：`runtime.root` 解析后必须位于登记根）。
   * 缺省取 `WB_PROJECTS_ROOT`；再缺省则不限制（向后兼容）。
   */
  registrationRoot?: string;
  /**
   * 注入 Memory Provider（默认 OpenViking + 本地降级）。
   * 供联合 E2E 以本地 stub 替代真实 OpenViking Sidecar，使链路可离线确定性回归。
   */
  memoryProvider?: MemoryProvider;
}

/** 构建 Fastify 应用（不监听端口，便于 inject 测试）。 */
export function buildApp(db: Database.Database, options: BuildAppOptions = {}): FastifyInstance {
  const dataDirConfig = options.dataDirConfig ?? resolveDataDir(process.env);
  const catalog = new ProjectCatalog(db, {
    registrationRoot: options.registrationRoot ?? resolveRegistrationRoot(process.env),
  });
  const manager = new ServiceManager();
  const runStore = new RunStore(db);
  const artifactStore = new ArtifactStore(db, options.artifactsRoot ?? 'var/artifacts');
  const modelStore = new ModelGatewayStore(db);
  const harnessProfileStore = new HarnessProfileStore(db);
  const approvalStore = new ApprovalStore(db);
  const auditStore = new AuditStore(db);
  const studioStore = new StudioStore(db);
  const assistantDraftStore = new AssistantDraftStore(db);
  const draftVerificationStore = new DraftVerificationStore(db);
  const extensionStore = new ExtensionStore(db);
  const issueStore = new IssueStore(db);
  const modelUsageStore = new ModelUsageStore(db);
  const memoryProvider =
    options.memoryProvider ??
    new FallbackMemoryProvider(new OpenVikingAdapter(), new InMemoryMemoryProvider());
  // 记忆中心投影（migration 0019）：候选审核状态 / 资源 / 召回审计持久化。
  const memoryCenterStore = new MemoryCenterStore(db);
  const memoryService = new MemoryService(memoryProvider, memoryCenterStore);
  const memoryReviewService = new MemoryReviewService(memoryProvider, undefined, memoryCenterStore);
  const memoryRecallService = new MemoryRecallService(memoryProvider, memoryCenterStore);
  const backupService = new BackupService(
    db,
    catalog,
    extensionStore,
    artifactStore,
    memoryProvider,
  );
  const restoreService = new RestoreService(backupService);
  const hub = options.hub ?? new RunStreamHub();
  // 可执行白名单策略（26 SPEC §5）：默认集合 + WB_ALLOWED_EXECUTABLES 扩展。
  const execPolicy = resolveExecutablePolicy(process.env);
  const jobRunner = new JobRunner(runStore, hub, execPolicy);
  // Agent Run 执行闭环（26 SPEC §13）：Harness 工具注册表（只读 + 受控写）+
  // 按 harnessProfileId 解析 adapter 的执行网关。此前 `ExecutionGateway` 与
  // `buildHarnessToolRegistry` 均只被测试引用（known-limitations #12）。
  const harnessSessionStore = new HarnessSessionStore(db);
  const harnessToolRegistry = buildHarnessToolRegistry(
    catalog,
    runStore,
    artifactStore,
    jobRunner,
    approvalStore,
  );
  const agentRunService = new AgentRunService(
    harnessProfileStore,
    harnessToolRegistry,
    runStore,
    harnessSessionStore,
    hub,
  );
  const roomStore = new RoomStore(db);
  const roomService = new RoomService(roomStore, runStore);
  const agentProfileStore = new AgentProfileStore(db);
  const agentSessionStore = new AgentSessionStore(db);
  const orchestrator = new RoomOrchestrator(createOrchestrationPorts(roomStore, agentSessionStore));
  // 自动轮次：把「Room 编排」与「真实模型调用（Harness Session）」接起来（UI-10）
  const roomAutoTurnService = new RoomAutoTurnService(
    orchestrator,
    roomStore,
    runStore,
    harnessSessionStore,
    agentRunService,
    hub,
  );
  const agentProfileService = new AgentProfileService(agentProfileStore, agentSessionStore);
  const decisionStore = new DecisionStore(db);
  const reviewService = new ReviewService(roomStore, decisionStore);
  const commandRegistry = new CommandRegistry(db);
  const projectService = new ProjectService(roomStore, commandRegistry, runStore, artifactStore);
  const sddService = new SddService(roomStore);
  const memoryRefinementService = new MemoryRefinementService(roomStore);
  const credentialStore =
    options.credentialStore ??
    (process.platform === 'win32' ? new WindowsCredentialStore() : new InMemoryCredentialStore());
  const cloudEgressGate = new CloudEgressGate(approvalStore);
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, request, reply) => {
    const requestId = (request.headers['x-request-id'] as string | undefined) ?? newRequestId();
    if (error instanceof AppError) {
      return reply.status(error.httpStatus).send(toErrorResponse(error, requestId));
    }
    request.log.error(error);
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'internal server error', details: {}, requestId },
    });
  });

  registerProjectRoutes(app, catalog, commandRegistry, {
    manager,
    auditStore,
    dataDir: dataDirConfig.dataDir,
  });
  registerRuntimeRoutes(app, catalog, manager, execPolicy);
  registerRunRoutes(app, runStore, hub, jobRunner);
  registerRoomRoutes(app, roomService, hub);
  registerOrchestrationRoutes(app, orchestrator, roomStore, hub, roomAutoTurnService);
  registerAgentProfileRoutes(app, agentProfileService);
  registerReviewRoutes(app, reviewService);
  registerRoomProjectRoutes(app, projectService);
  registerSddRoutes(app, sddService);
  registerRefinementRoutes(app, memoryRefinementService);
  registerMemoryRoutes(app, {
    service: memoryService,
    provider: memoryProvider,
    review: memoryReviewService,
    recall: memoryRecallService,
    center: memoryCenterStore,
  });
  registerJobRoutes(app, catalog, jobRunner);
  registerArtifactRoutes(app, artifactStore);
  registerModelRoutes(app, modelStore, credentialStore, cloudEgressGate);
  registerHarnessRoutes(app, harnessProfileStore);
  registerAgentRunRoutes(app, agentRunService);
  registerStudioRoutes(app, studioStore);
  registerAssistantRoutes(app, assistantDraftStore);
  registerDraftVerificationRoutes(app, studioStore, assistantDraftStore, draftVerificationStore);
  registerExtensionRoutes(app, extensionStore, studioStore);
  registerIssueRoutes(app, issueStore, memoryReviewService);
  registerCredentialRoutes(app, credentialStore, auditStore);
  registerApprovalRoutes(app, approvalStore);
  registerOverviewRoutes(app, catalog, runStore, artifactStore);
  registerUsageRoutes(app, modelUsageStore);
  registerDiagnosticsRoutes(
    app,
    new DiagnosticsService(db, catalog, runStore, modelStore, migrations),
  );
  registerBackupRoutes(app, backupService);
  registerRestoreRoutes(app, restoreService);
  registerAppInfoRoutes(app, buildAppInfo(dataDirConfig));
  return app;
}
