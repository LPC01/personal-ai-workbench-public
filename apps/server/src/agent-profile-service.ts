import { randomUUID } from 'node:crypto';
import { AppError, intersectToolPolicies } from '@workbench/domain';
import type {
  AgentProfile,
  AgentProfileDefinition,
  AgentSession,
  AgentToolPolicy,
  ModelBinding,
} from '@workbench/contracts';
import type { AgentProfileStore, AgentSessionStore } from '@workbench/persistence';

/**
 * AgentProfile 与 AgentSession 服务（29 号 SPEC §6/§7/§16/§19）。
 * - AgentProfile 版本化（system instruction、I/O Schema、工具/上下文策略、模型能力要求、默认超时）；
 * - RoomRun 创建时为每个 Participant 创建独立 AgentSession，固定 AgentProfile 快照、
 *   模型绑定快照与工具策略（权限交集 ROOM-SEC-001）。
 */
export class AgentProfileService {
  constructor(
    private readonly profileStore: AgentProfileStore,
    private readonly sessionStore: AgentSessionStore,
  ) {}

  upsertProfile(input: {
    id: string;
    definition: AgentProfileDefinition;
    status?: string;
  }): AgentProfile {
    return this.profileStore.upsert(input);
  }

  getProfile(id: string, revision?: number): AgentProfile {
    const profile = this.profileStore.get(id, revision);
    if (!profile) {
      throw new AppError('AGENT_PROFILE_NOT_FOUND', 'AgentProfile 不存在', {
        details: { id, revision },
      });
    }
    return profile;
  }

  listProfiles(): AgentProfile[] {
    return this.profileStore.list();
  }

  /**
   * 创建 AgentSession：固定 AgentProfile 快照 + 模型绑定 + 工具权限交集。
   * 每个 Participant 在每个 RoomRun 唯一（§7：独立会话，不共享隐藏上下文）。
   */
  createSession(input: {
    roomRunId: string;
    participantId: string;
    agentProfileId: string;
    agentProfileRevision?: number;
    modelBinding: ModelBinding;
    toolPolicies: AgentToolPolicy[];
  }): AgentSession {
    const profile = this.getProfile(input.agentProfileId, input.agentProfileRevision);
    const agentProfileSnapshot: Record<string, unknown> = {
      id: profile.id,
      revision: profile.revision,
      definition: profile.definition,
      definitionHash: profile.definitionHash,
    };
    const toolPolicy = intersectToolPolicies(input.toolPolicies);
    return this.sessionStore.create({
      id: `session_${randomUUID()}`,
      roomRunId: input.roomRunId,
      participantId: input.participantId,
      agentProfileSnapshot,
      modelBinding: input.modelBinding,
      toolPolicy,
    });
  }

  getSession(id: string): AgentSession {
    const session = this.sessionStore.get(id);
    if (!session) {
      throw new AppError('AGENT_SESSION_NOT_FOUND', 'AgentSession 不存在', { details: { id } });
    }
    return session;
  }

  listSessions(roomRunId: string): AgentSession[] {
    return this.sessionStore.list(roomRunId);
  }

  advanceContextCursor(id: string, cursor: number): AgentSession {
    return this.sessionStore.updateContextCursor(id, cursor);
  }
}
