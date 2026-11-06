import { createHash, randomUUID } from 'node:crypto';
import { AppError, assertCommandAllowed, assertProjectScope } from '@workbench/domain';
import type { RoomProject } from '@workbench/contracts';
import type { ArtifactRecord, ArtifactStore, RoomStore, RunStore } from '@workbench/persistence';
import type { CommandRegistry } from '@workbench/project-runtime';

function sha256(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/**
 * 项目集成服务（29 号 SPEC §13）：项目绑定、命令执行（→ 平台 Run）、Artifact 记录。
 * - Agent 只能调用项目 Manifest 已登记且 ToolPolicy 允许的命令；
 * - 命令执行必须创建平台 Run，Run ID 作为 Tool Result；
 * - Artifact 记录来源 RoomRun、平台 Run、Project 与 SHA-256。
 */
export class ProjectService {
  constructor(
    private readonly roomStore: RoomStore,
    private readonly commandRegistry: CommandRegistry,
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactStore,
  ) {}

  bindProject(input: {
    roomId: string;
    projectId: string;
    access: 'read' | 'execute';
  }): RoomProject {
    return this.roomStore.bindProject(input);
  }

  listProjects(roomId: string): RoomProject[] {
    return this.roomStore.listProjects(roomId);
  }

  /** 执行命令：作用域校验 → 命令登记/权限校验 → 创建平台 Run → 追加 Tool Call 事件。 */
  executeCommand(input: {
    roomId: string;
    roomRunId: string;
    projectId: string;
    commandId: string;
    actorRef: string;
    allowedTools: string[];
    args?: string[];
    requiresWrite?: boolean;
  }): { runId: string; commandRef: string } {
    const project = this.roomStore.getProject(input.roomId, input.projectId);
    const access = (project?.access as { access?: 'read' | 'execute' } | undefined)?.access;
    const scopeErr = assertProjectScope(input.projectId, access, input.requiresWrite ?? true);
    if (scopeErr) {
      throw new AppError('ROOM_PROJECT_SCOPE_DENIED', scopeErr, {
        details: { projectId: input.projectId },
      });
    }

    const command = this.commandRegistry.getCommand(input.projectId, input.commandId);
    const cmdErr = assertCommandAllowed(
      input.commandId,
      new Set(input.allowedTools),
      new Set(command ? [input.commandId] : []),
    );
    if (cmdErr) {
      throw new AppError('PARTICIPANT_NOT_ALLOWED', cmdErr, {
        details: { commandId: input.commandId },
      });
    }

    const commandRef = `${input.projectId}:${input.commandId}`;
    const run = this.runStore.createRun({
      id: `run_${randomUUID()}`,
      projectId: input.projectId,
      kind: 'builder',
      commandRef,
      input: { args: input.args ?? [], roomRunId: input.roomRunId },
    });
    this.roomStore.appendEvent({
      roomRunId: input.roomRunId,
      eventType: 'TOOL_CALL_REQUESTED',
      actorRef: input.actorRef,
      payload: { runId: run.id, commandRef, projectId: input.projectId },
      payloadHash: sha256({ runId: run.id }),
    });
    return { runId: run.id, commandRef };
  }

  /** 记录 Artifact（§13.7：来源 RoomRun + 平台 Run + Project + SHA-256）。 */
  recordArtifact(input: {
    roomRunId: string;
    projectId: string;
    runId: string;
    kind: string;
    logicalName: string;
    content: Buffer;
    mediaType?: string;
  }): ArtifactRecord {
    const artifact = this.artifactStore.create({
      runId: input.runId,
      projectId: input.projectId,
      kind: input.kind,
      logicalName: input.logicalName,
      content: input.content,
      mediaType: input.mediaType,
    });
    this.roomStore.appendEvent({
      roomRunId: input.roomRunId,
      eventType: 'EVIDENCE_ATTACHED',
      actorRef: 'system',
      payload: {
        artifactId: artifact.id,
        roomRunId: input.roomRunId,
        runId: input.runId,
        projectId: input.projectId,
        sha256: artifact.sha256,
      },
      payloadHash: sha256({ artifactId: artifact.id }),
    });
    return artifact;
  }
}
