export interface Project {
  id: string;
  name: string;
  rootPath: string;
  manifestHash: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  /** manifest `project.description` 的回填；老登记未填时该键不存在。 */
  description?: string;
}

/** 项目自述文件（README）读取结果；`found:false` 表示登记根顶层没有自述文件。 */
export interface ProjectReadme {
  id: string;
  rootPath: string;
  found: boolean;
  fileName?: string;
  sizeBytes?: number;
  content?: string;
  truncated?: boolean;
  error?: string;
}

export interface ServiceState {
  serviceId: string;
  projectId: string;
  commandId: string;
  pid: number;
  port: number;
  status: string;
  startedAt: string;
}

/** 携带平台错误码的 API 错误（26 SPEC §10 统一错误体）。 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 仅在确有 body 时声明 JSON Content-Type：否则 Fastify 会因空 body 解析失败返回 500。
  const hasBody = init?.body !== undefined;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string; code?: string; details?: Record<string, unknown> };
    } | null;
    throw new ApiError(
      body?.error?.message ?? `HTTP ${res.status}`,
      body?.error?.code,
      res.status,
      body?.error?.details ?? {},
    );
  }
  return (await res.json()) as T;
}

export function listProjects(): Promise<{ items: Project[]; total: number }> {
  return request('/api/v1/projects');
}

export function getProject(projectId: string): Promise<Project> {
  return request(`/api/v1/projects/${projectId}`);
}

export function startRuntime(projectId: string): Promise<ServiceState> {
  return request(`/api/v1/projects/${projectId}/runtime/start`, { method: 'POST' });
}

export function stopRuntime(projectId: string): Promise<ServiceState> {
  return request(`/api/v1/projects/${projectId}/runtime/stop`, { method: 'POST' });
}

/**
 * 查询项目**当前**运行时状态（RT-03 新增端点）。
 * 此前状态只能从 start / stop 的响应里拿到快照，切到别的视图再回来显示的是陈旧值。
 */
export function getRuntime(projectId: string): Promise<ServiceState> {
  return request(`/api/v1/projects/${projectId}/runtime`);
}

export function getLogs(projectId: string): Promise<{ stdout: string; stderr: string }> {
  return request(`/api/v1/projects/${projectId}/logs`);
}

/**
 * 读取项目自述文件（PROJ-UI-01）。
 * `probe` 为真时只取元信息（文件名 / 字节数），用于列表页批量探测，不传正文。
 */
export function getReadme(projectId: string, probe = false): Promise<ProjectReadme> {
  return request(`/api/v1/projects/${projectId}/readme${probe ? '?probe=1' : ''}`);
}

export interface ProjectRemovalResult {
  removed: boolean;
  id: string;
  name: string;
  rootPath: string;
  cascade: {
    roomProjects: number;
    artifacts: number;
    runEvents: number;
    runs: number;
    commands: number;
  };
  stoppedServices: string[];
  manifestSnapshot: string | null;
  warning?: string;
}

/**
 * 注销项目（规范外扩展：26 SPEC §10.1 无 delete 端点）。
 * 只注销登记，不删除磁盘上的项目目录；`force` 时先停止运行中的服务。
 */
export function removeProject(projectId: string, force = false): Promise<ProjectRemovalResult> {
  return request(`/api/v1/projects/${projectId}${force ? '?force=1' : ''}`, { method: 'DELETE' });
}

/** 登记项目：提交完整 `workbench.project/v1` manifest（服务端不扫目录）。 */
export function registerProject(manifest: unknown): Promise<Project> {
  return request('/api/v1/projects/register', { method: 'POST', body: JSON.stringify(manifest) });
}

export interface Run {
  id: string;
  projectId: string | null;
  taskId: string | null;
  kind: string;
  status: string;
  commandRef: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  errorCode: string | null;
  createdAt: string;
}

export interface RunEvent {
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Artifact {
  id: string;
  runId: string;
  kind: string;
  logicalName: string;
  sha256: string;
  mediaType: string | null;
  sizeBytes: number;
  createdAt: string;
}

export function listRuns(): Promise<{ items: Run[]; total: number }> {
  return request('/api/v1/runs');
}

export function getRun(runId: string): Promise<Run> {
  return request(`/api/v1/runs/${runId}`);
}

export function listRunEvents(runId: string): Promise<{ items: RunEvent[]; total: number }> {
  return request(`/api/v1/runs/${runId}/events`);
}

export function listRunArtifacts(runId: string): Promise<{ items: Artifact[]; total: number }> {
  return request(`/api/v1/runs/${runId}/artifacts`);
}

export interface ModelProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'ollama';
  baseUrl: string | null;
  /** 凭据引用（32 SPEC §3 CRED）：真实 Secret 不进 SQLite，此处只存引用。 */
  credentialRef: string | null;
  revision: number;
}

export interface ModelProfile {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  capabilities: string[];
  contextLimit: number;
  dataBoundary: 'local-only' | 'cloud';
  fallbackProfileId: string | null;
  revision: number;
}

export interface ProbeResult {
  healthy: boolean;
  models: string[];
  error?: string;
}

export function listProviders(): Promise<{ items: ModelProvider[]; total: number }> {
  return request('/api/v1/model-providers');
}

export function upsertProvider(provider: {
  id: string;
  name: string;
  type: string;
  baseUrl?: string;
  credentialRef?: string | null;
}): Promise<ModelProvider> {
  return request('/api/v1/model-providers', { method: 'POST', body: JSON.stringify(provider) });
}

export function probeProvider(id: string): Promise<ProbeResult> {
  return request(`/api/v1/model-providers/${id}/probe`, { method: 'POST' });
}

/** 凭据描述符（32 SPEC §3.3）：只含引用与掩码，绝不含明文 Secret。 */
export interface CredentialDescriptor {
  ref: string;
  type: 'api_key' | 'oauth' | 'password' | 'other';
  /** 掩码形态（如 `****abcd`）。 */
  masked: string;
  createdAt: string;
  updatedAt: string;
  status: string;
}

/**
 * 登记外部 API Key（32 SPEC §3.3 CRED）。
 *
 * 明文只在本次请求体中出现一次，服务端加密落盘（Windows 为 DPAPI CurrentUser）；
 * 响应只回 ref 与掩码。前端随后只把 ref 绑定到 Provider，Secret 不进 SQLite。
 */
export function createCredential(input: {
  secret: string;
  type?: CredentialDescriptor['type'];
  ref?: string;
}): Promise<CredentialDescriptor> {
  return request('/api/v1/credentials', { method: 'POST', body: JSON.stringify(input) });
}

/** 查询凭据状态（只读描述符）；引用不存在时会抛 CREDENTIAL_NOT_FOUND。 */
export function describeCredential(ref: string): Promise<CredentialDescriptor> {
  return request(`/api/v1/credentials/${encodeURIComponent(ref)}`);
}

/** 销毁凭据本体。调用前请先解绑 Provider，避免留下悬空引用。 */
export function deleteCredential(ref: string): Promise<{ deleted: string }> {
  return request(`/api/v1/credentials/${encodeURIComponent(ref)}`, { method: 'DELETE' });
}

export function listProfiles(): Promise<{ items: ModelProfile[]; total: number }> {
  return request('/api/v1/model-profiles');
}

export function upsertProfile(profile: {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  capabilities: string[];
  contextLimit: number;
  dataBoundary: string;
  fallbackProfileId?: string;
}): Promise<ModelProfile> {
  return request('/api/v1/model-profiles', { method: 'POST', body: JSON.stringify(profile) });
}

export interface StudioSession {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

export interface ExtensionDraft {
  id: string;
  sessionId: string;
  spec: {
    extension: { id: string; name: string; version: string; types: string[] };
    permissions: {
      files: { read: string[]; write: string[] };
      commands: string[];
      network: boolean;
      credentials: string[];
    };
  };
  status: string;
}

export interface PermissionReview {
  draftId: string;
  extensionName: string;
  dataFlow: {
    inputs: string[];
    outputs: string[];
    commands: string[];
    network: boolean;
    credentials: string[];
  };
  risks: { level: string; reason: string }[];
}

export function createStudioSession(title: string): Promise<StudioSession> {
  return request('/api/v1/studio/sessions', { method: 'POST', body: JSON.stringify({ title }) });
}

export function addStudioMessage(sessionId: string, content: string): Promise<unknown> {
  return request(`/api/v1/studio/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role: 'user', content }),
  });
}

export function generateSpec(sessionId: string): Promise<ExtensionDraft> {
  return request(`/api/v1/studio/sessions/${sessionId}/generate-spec`, { method: 'POST' });
}

export function getPermissionReview(draftId: string): Promise<PermissionReview> {
  return request(`/api/v1/extension-drafts/${draftId}/permissions-review`);
}

export interface AssistantDraft {
  id: string;
  extensionDraftId: string;
  systemPrompt: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  outputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  toolWhitelist: string[];
  modelRequirements: Record<string, unknown>;
}

export function getAssistantDraft(draftId: string): Promise<AssistantDraft | null> {
  return request(`/api/v1/extension-drafts/${draftId}/assistant`);
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function listIssues(): Promise<{ items: Issue[]; total: number }> {
  return request('/api/v1/issues');
}

export function createIssue(title: string, description: string): Promise<Issue> {
  return request('/api/v1/issues', {
    method: 'POST',
    body: JSON.stringify({ title, description }),
  });
}

export function resolveIssue(issueId: string): Promise<Issue> {
  return request(`/api/v1/issues/${issueId}/resolve`, { method: 'POST' });
}

export function verifyIssue(issueId: string): Promise<Issue> {
  return request(`/api/v1/issues/${issueId}/verify`, { method: 'POST' });
}

export interface ModelUsageOverview {
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  totalCost: number;
}

export interface ModelUsageByModel {
  modelId: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
  totalCost: number;
}

export interface ModelUsageByDay {
  day: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
}

export function getUsageOverview(): Promise<ModelUsageOverview> {
  return request('/api/v1/usage/overview');
}

export function getUsageByModel(): Promise<ModelUsageByModel[]> {
  return request('/api/v1/usage/by-model');
}

export function getUsageByDay(): Promise<ModelUsageByDay[]> {
  return request('/api/v1/usage/by-day');
}

export interface DiagnosticsCheck {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  detail: string;
}

export interface DiagnosticsReport {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  checkedAt: string;
  checks: DiagnosticsCheck[];
  summary: {
    schemaVersion: number;
    projects: number;
    modelProviders: number;
    modelProfiles: number;
    totalRuns: number;
    activeRuns: number;
  };
}

export function getDiagnostics(): Promise<DiagnosticsReport> {
  return request('/api/v1/diagnostics');
}

export interface Room {
  id: string;
  name: string;
  roomType: string;
  manifestHash: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoomEvent {
  id: number;
  roomRunId: string;
  sequence: number;
  eventType: string;
  actorRef: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function listRooms(): Promise<{ items: Room[]; total: number }> {
  return request('/api/v1/rooms');
}

export function createRoom(input: {
  name: string;
  roomType: string;
  manifest: Record<string, unknown>;
}): Promise<Room> {
  return request('/api/v1/rooms', { method: 'POST', body: JSON.stringify(input) });
}

export function activateRoom(roomId: string): Promise<Room> {
  return request(`/api/v1/rooms/${roomId}/activate`, { method: 'POST' });
}

/** Room ↔ Project 绑定（29 号 SPEC §13.1：读/执行权限）。 */
export interface RoomProjectBinding {
  roomId: string;
  projectId: string;
  access: Record<string, unknown>;
}

export function listRoomProjects(
  roomId: string,
): Promise<{ items: RoomProjectBinding[]; total: number }> {
  return request(`/api/v1/rooms/${roomId}/projects`);
}

/** RoomRun（29 号 SPEC §8）：状态机、协议快照、预算与用量。 */
export interface RoomRun {
  id: string;
  roomId: string;
  topicId: string | null;
  protocolId: string;
  protocolVersion: string;
  snapshot: Record<string, unknown>;
  budget: Record<string, unknown>;
  usage: Record<string, unknown>;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  createdAt: string;
}

export function createRoomRun(
  roomId: string,
  input: { protocolId: string; protocolVersion: string },
): Promise<RoomRun> {
  return request(`/api/v1/rooms/${roomId}/runs`, { method: 'POST', body: JSON.stringify(input) });
}

export function getRoomRun(runId: string): Promise<RoomRun> {
  return request(`/api/v1/room-runs/${runId}`);
}

/** 按房间列出 Run（29 号 SPEC §11 缺口补齐；known-limitations #8）。 */
export function listRoomRuns(roomId: string): Promise<{ items: RoomRun[]; total: number }> {
  return request(`/api/v1/rooms/${roomId}/runs`);
}

export function pauseRoomRun(runId: string): Promise<RoomRun> {
  return request(`/api/v1/room-runs/${runId}/pause`, { method: 'POST' });
}

export function resumeRoomRun(runId: string): Promise<RoomRun> {
  return request(`/api/v1/room-runs/${runId}/resume`, { method: 'POST' });
}

/** 模型绑定快照（29 号 SPEC §16）：Run override > AgentProfile > Room > Project > Global。 */
export interface ModelBinding {
  modelProfileId: string;
  providerId?: string;
  revision: number;
  override?: Record<string, unknown>;
}

/** 工具策略（29 号 SPEC §19 ROOM-SEC-001）：Room/Project/AgentProfile/ToolPolicy 交集。 */
export interface AgentToolPolicy {
  allowedTools: string[];
  deniedTools?: string[];
  allowPermissionExpansion?: boolean;
}

/** AgentSession（29 号 SPEC §7）：每个 Participant 独立会话 + 三类不可变快照。 */
export interface AgentSession {
  id: string;
  roomRunId: string;
  participantId: string;
  agentProfileSnapshot: Record<string, unknown>;
  modelBinding: ModelBinding;
  toolPolicy: AgentToolPolicy;
  contextCursor: number;
  status: string;
  createdAt: string;
}

export function listAgentSessions(
  runId: string,
): Promise<{ items: AgentSession[]; total: number }> {
  return request(`/api/v1/room-runs/${runId}/sessions`);
}

export function getAgentSession(id: string): Promise<AgentSession> {
  return request(`/api/v1/agent-sessions/${id}`);
}

/** RoomWorkItem（29 号 SPEC §9.3）：共享任务板条目。 */
export interface RoomWorkItem {
  id: string;
  roomRunId: string;
  assigneeRef: string | null;
  kind: string;
  status: string;
  inputRefs: string[];
  acceptance: Record<string, unknown>;
  outputRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export function listWorkItems(runId: string): Promise<RoomWorkItem[]> {
  return request(`/api/v1/room-runs/${runId}/work-items`);
}

export function postRoomMessage(
  runId: string,
  actorRef: string,
  content: string,
): Promise<RoomEvent> {
  return request(`/api/v1/room-runs/${runId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ actorRef, content }),
  });
}

export function listRoomEvents(runId: string): Promise<{ items: RoomEvent[]; total: number }> {
  return request(`/api/v1/room-runs/${runId}/events`);
}

/* ------------------------------------------------------------------ *
 * 编排运行时（UI-10 接线：此前后端已有端点、前端零调用）
 * ------------------------------------------------------------------ */

/** 参与者快照（29 SPEC §7.1）：agentProfileSnapshot 由后端按配置折叠。 */
export interface ParticipantInput {
  participantId: string;
  agentProfileId?: string;
  /** 有值时后端为该参与者建立 Harness Session（自动轮次的模型调用载体）。 */
  harnessProfileId?: string;
  modelBinding: ModelBinding;
  toolPolicy: AgentToolPolicy;
  systemInstruction?: string;
}

export interface StartOrchestrationInput {
  participants: ParticipantInput[];
  limits: {
    maxTurns: number;
    maxDurationSeconds: number;
    maxTotalTokens: number;
    maxCost: number;
    noProgressTurns: number;
  };
  workItems?: { kind: string; assigneeRef?: string | null }[];
}

export interface OrchestrationStartResult {
  run: RoomRun;
  sessions: AgentSession[];
  workItems: RoomWorkItem[];
}

export function startOrchestration(
  runId: string,
  input: StartOrchestrationInput,
): Promise<OrchestrationStartResult> {
  return request(`/api/v1/room-runs/${runId}/orchestrate/start`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 手动派发一轮（内容由调用方提供，不经模型）。 */
export function dispatchRoomTurn(
  runId: string,
  input: { participantId: string; allowedParticipants: string[]; content: string; tokens?: number },
): Promise<{ run: RoomRun; event: RoomEvent }> {
  return request(`/api/v1/room-runs/${runId}/orchestrate/turn`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface AutoTurnRecord {
  participantId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  content: string;
  tokens: number;
  platformRunId: string | null;
  errorCode?: string;
}

export interface AutoTurnResult {
  run: RoomRun;
  turns: AutoTurnRecord[];
  stoppedReason: string | null;
}

/** 自动轮次：推进 N 位参与者真实发言（模型调用 → 编排门禁）。 */
export function autoTurn(
  runId: string,
  input: {
    content?: string;
    participantId?: string;
    rounds?: number;
    timeoutSeconds?: number;
  },
): Promise<AutoTurnResult> {
  return request(`/api/v1/room-runs/${runId}/orchestrate/auto-turn`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Handoff 交接（29 SPEC §12.2）。 */
export function handoffWorkItem(
  runId: string,
  input: {
    handoff: {
      toParticipantId: string;
      workItemId: string;
      objective: string;
      inputRefs: string[];
      acceptance: string[];
      reason: string;
    };
    allowedParticipants: string[];
  },
): Promise<{ workItem: RoomWorkItem; event: RoomEvent }> {
  return request(`/api/v1/room-runs/${runId}/orchestrate/handoff`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 运行中新增任务条目（UI-10 补齐）。 */
export function createWorkItem(
  runId: string,
  input: { kind: string; assigneeRef?: string | null },
): Promise<RoomWorkItem> {
  return request(`/api/v1/room-runs/${runId}/orchestrate/work-items`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 任务板状态流转（29 SPEC §9.3）。 */
export function updateWorkItem(
  runId: string,
  workItemId: string,
  input: { status: string; outputRefs?: string[] },
): Promise<RoomWorkItem> {
  return request(`/api/v1/room-runs/${runId}/orchestrate/work-items/${workItemId}`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 结束编排（终态）。 */
export function finishRoomRun(runId: string, status: string): Promise<RoomRun> {
  return request(`/api/v1/room-runs/${runId}/orchestrate/finish`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export function cancelRoomRun(runId: string): Promise<RoomRun> {
  return request(`/api/v1/room-runs/${runId}/cancel`, { method: 'POST' });
}

/** AgentProfile（29 SPEC §6）：参与者角色定义的持久化载体。 */
export interface AgentProfile {
  id: string;
  revision: number;
  definition: {
    systemInstruction: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    defaultTimeoutSeconds?: number;
  };
  status: string;
  createdAt: string;
}

export function listAgentProfiles(): Promise<{ items: AgentProfile[]; total: number }> {
  return request('/api/v1/agent-profiles');
}

export function upsertAgentProfile(input: {
  id: string;
  definition: AgentProfile['definition'];
  status?: string;
}): Promise<AgentProfile> {
  return request('/api/v1/agent-profiles', { method: 'POST', body: JSON.stringify(input) });
}

/**
 * 订阅 RoomRun 事件流（SSE，30 号基线 §3.1：消息流需区分多类事件）。
 * 带 `?after=` 游标做断点续传（借鉴 OpenHands 的 seq 游标做法）；
 * 服务端可能重推历史事件，故回调内自行去重。
 */
export function subscribeRoomRunStream(
  runId: string,
  opts: {
    after?: number;
    onEvent: (event: {
      sequence: number;
      eventType: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }) => void;
    onStatus?: (state: 'connecting' | 'open' | 'error') => void;
  },
): () => void {
  const url = `/api/v1/room-runs/${runId}/stream${opts.after ? `?after=${opts.after}` : ''}`;
  const source = new EventSource(url);
  opts.onStatus?.('connecting');
  source.onopen = () => opts.onStatus?.('open');
  source.onerror = () => opts.onStatus?.('error');
  source.onmessage = (ev) => {
    try {
      const parsed = JSON.parse(ev.data) as {
        sequence: number;
        eventType: string;
        payload: Record<string, unknown>;
        createdAt: string;
      };
      opts.onEvent(parsed);
    } catch {
      // 心跳/非 JSON 帧忽略
    }
  };
  return () => source.close();
}

export const SDD_STAGES = [
  'INTAKE',
  'SPEC_DRAFT',
  'SPEC_REVIEW',
  'WAITING_SPEC_APPROVAL',
  'IMPLEMENTATION',
  'VERIFICATION',
  'INDEPENDENT_REVIEW',
  'DECISION',
  'ARCHIVE',
] as const;

export type SddStage = (typeof SDD_STAGES)[number];

export interface SddGateContext {
  specApproved: boolean;
  reviewDecision?: 'ACCEPTED' | 'REWORK' | 'REJECTED';
  hasFinalArtifact: boolean;
}

export function getSddStage(runId: string): Promise<{ stage: SddStage }> {
  return request(`/api/v1/room-runs/${runId}/sdd-stage`);
}

export function advanceSddStage(runId: string, ctx: SddGateContext): Promise<{ stage: SddStage }> {
  return request(`/api/v1/room-runs/${runId}/sdd-advance`, {
    method: 'POST',
    body: JSON.stringify(ctx),
  });
}

export interface Approval {
  id: string;
  actionType: string;
  targetRef: string;
  request: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  expiresAt: string;
  decidedAt: string | null;
  createdAt: string;
}

export function listApprovals(): Promise<{ items: Approval[]; total: number }> {
  return request('/api/v1/approvals');
}

export function decideApproval(id: string, approved: boolean): Promise<Approval> {
  return request(`/api/v1/approvals/${id}/decide`, {
    method: 'POST',
    body: JSON.stringify({ approved }),
  });
}

export interface Decision {
  id: string;
  roomRunId: string;
  decisionType: string;
  result: Record<string, unknown>;
  evidenceRefs: string[];
  status: string;
  createdAt: string;
}

export function listDecisions(runId: string): Promise<{ items: Decision[]; total: number }> {
  return request(`/api/v1/room-runs/${runId}/decisions`);
}

/**
 * Harness Profile（26 SPEC §13 + 设计 §6.9）：Agent 执行内核的连接层配置（不含凭据）。
 */
export interface HarnessProfile {
  id: string;
  name: string;
  adapterType: 'deepseek' | 'openai-agents' | 'mock';
  config: Record<string, unknown>;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export function listHarnessProfiles(): Promise<{ items: HarnessProfile[]; total: number }> {
  return request('/api/v1/harness-profiles');
}

/**
 * 新建或修订 Harness Profile（后端为 upsert：同 id 再次提交即 revision +1）。
 * 后端无删除端点，因此本工作台不提供删除入口（见 UI-09 证据包「诚实边界」）。
 */
export function upsertHarnessProfile(input: {
  id: string;
  name: string;
  adapterType: HarnessProfile['adapterType'];
  config?: Record<string, unknown>;
}): Promise<HarnessProfile> {
  return request('/api/v1/harness-profiles', { method: 'POST', body: JSON.stringify(input) });
}

export interface HarnessProbeResult {
  id: string;
  adapterType: string;
  health: { ok: boolean; detail?: string };
}

/** 探测 Harness 健康（实例化 Adapter 检查，不落库）。 */
export function probeHarnessProfile(id: string): Promise<HarnessProbeResult> {
  return request(`/api/v1/harness-profiles/${id}/probe`, { method: 'POST' });
}

/** Harness Session 记录（含 run 关联，用于断线/重启恢复）。 */
export interface AgentSessionRecord {
  id: string;
  runId: string | null;
  harnessProfileId: string;
  modelProfileId: string;
  agentProfileId: string | null;
  toolPolicy: { allowedToolIds: string[]; constraints: Record<string, unknown> };
  status: string;
  contextCursor: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunStartResult {
  session: AgentSessionRecord;
  run: Run;
}

/**
 * 发起 Agent Run（26 SPEC §13）：创建平台 Run（kind=agent）+ Harness Session 绑定。
 * 事件与 SSE 复用既有 `/api/v1/runs/{runId}/events` 与 `/stream`。
 */
export function startAgentRun(input: {
  harnessProfileId: string;
  modelProfileId: string;
  prompt: string;
  projectId?: string;
  agentProfileId?: string;
  toolPolicy?: { allowedToolIds: string[]; constraints?: Record<string, unknown> };
}): Promise<AgentRunStartResult> {
  return request('/api/v1/agent-runs', { method: 'POST', body: JSON.stringify(input) });
}

/** 执行一个回合（含工具回环、超时、取消）。 */
export function sendAgentTurn(
  sessionId: string,
  prompt: string,
  timeoutSeconds?: number,
): Promise<{ run: Run }> {
  return request(`/api/v1/agent-runs/${sessionId}/turns`, {
    method: 'POST',
    body: JSON.stringify(timeoutSeconds === undefined ? { prompt } : { prompt, timeoutSeconds }),
  });
}

export function cancelAgentRun(sessionId: string): Promise<{ run: Run }> {
  return request(`/api/v1/agent-runs/${sessionId}/cancel`, { method: 'POST' });
}

export interface AgentResumeResult {
  session: AgentSessionRecord;
  run: Run | undefined;
  events: { sequence: number; eventType: string; payload: Record<string, unknown> }[];
}

/** 会话恢复：返回会话 + 游标之后的 Run 事件（断线 / 重启续传）。 */
export function resumeAgentRun(sessionId: string): Promise<AgentResumeResult> {
  return request(`/api/v1/agent-runs/${sessionId}`);
}

/** 记忆健康（32 SPEC §4.2）：区分不可用 / 降级 / 只读就绪 / 读写就绪。 */
export interface MemoryHealth {
  status: 'UNAVAILABLE' | 'DEGRADED' | 'READY_READONLY' | 'READY_READWRITE';
  ok: boolean;
  detail?: string;
}

export function getMemoryHealth(): Promise<MemoryHealth> {
  return request('/api/v1/memory/health');
}

/** 只读导入资源（不改源资源；服务端做 sourceHash 幂等 + Secret/PII 守卫）。 */
export function importMemoryResource(input: {
  projectId: string;
  name: string;
  content: string;
  sensitivity?: 'public' | 'internal' | 'confidential';
  sourceRefs?: string[];
}): Promise<{ uri: string }> {
  return request('/api/v1/memory/import', { method: 'POST', body: JSON.stringify(input) });
}

export interface MemoryHit {
  uri: string;
  score: number;
  snippet?: string;
}

/** 项目范围语义检索（默认限定当前项目，排除 superseded/revoked）。 */
export function searchMemory(input: {
  projectId: string;
  query: string;
  limit?: number;
}): Promise<{ items: MemoryHit[]; total: number }> {
  return request('/api/v1/memory/search', { method: 'POST', body: JSON.stringify(input) });
}

/** 记忆中心（25 设计「记忆中心」子树）：候选审核状态。 */
export type MemoryCenterStatus = 'CANDIDATE' | 'VERIFIED' | 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';

export interface MemoryCandidate {
  uri: string;
  projectId: string | null;
  scope: string;
  content: string;
  status: MemoryCenterStatus;
  sourceUri: string | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function memoryQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/** 候选收件箱 / Superseded 列表。 */
export function listMemoryCandidates(
  input: {
    projectId?: string;
    statuses?: MemoryCenterStatus[];
  } = {},
): Promise<{ items: MemoryCandidate[]; total: number }> {
  return request(
    `/api/v1/memory/candidates${memoryQuery({
      projectId: input.projectId,
      status: input.statuses?.length ? input.statuses.join(',') : undefined,
    })}`,
  );
}

export function proposeMemoryCandidate(input: {
  content: string;
  projectId?: string;
  scope?: string;
  sourceUri?: string;
}): Promise<{ ref: { uri: string }; status: MemoryCenterStatus }> {
  return request('/api/v1/memory/candidates', { method: 'POST', body: JSON.stringify(input) });
}

function transitionCandidate(
  uri: string,
  action: 'verify' | 'activate' | 'revoke',
): Promise<{ uri: string; status: MemoryCenterStatus }> {
  return request(`/api/v1/memory/candidates/${encodeURIComponent(uri)}/${action}`, {
    method: 'POST',
  });
}

export const verifyMemoryCandidate = (uri: string) => transitionCandidate(uri, 'verify');
export const activateMemoryCandidate = (uri: string) => transitionCandidate(uri, 'activate');
export const revokeMemoryCandidate = (uri: string) => transitionCandidate(uri, 'revoke');

export function supersedeMemoryCandidate(
  uri: string,
  supersededBy?: string,
): Promise<{ uri: string; status: MemoryCenterStatus }> {
  return request(`/api/v1/memory/candidates/${encodeURIComponent(uri)}/supersede`, {
    method: 'POST',
    body: JSON.stringify({ supersededBy }),
  });
}

/** 全量 Resources 列表（工作台侧投影）。 */
export interface MemoryResource {
  uri: string;
  projectId: string;
  name: string;
  sensitivity: 'public' | 'internal' | 'confidential';
  sourceHash: string | null;
  createdAt: string;
}

export function listMemoryResources(
  projectId?: string,
): Promise<{ items: MemoryResource[]; total: number }> {
  return request(`/api/v1/memory/resources${memoryQuery({ projectId })}`);
}

/** 检索与召回审计。 */
export interface RecallAudit {
  id: string;
  projectId: string | null;
  query: string;
  scope: string;
  hitUris: string[];
  totalTokens: number;
  budgetTokens: number;
  injectedPosition: 'context';
  createdAt: string;
}

export function listRecallAudits(
  input: {
    projectId?: string;
    limit?: number;
  } = {},
): Promise<{ items: RecallAudit[]; total: number }> {
  return request(
    `/api/v1/memory/recall-audit${memoryQuery({
      projectId: input.projectId,
      limit: input.limit !== undefined ? String(input.limit) : undefined,
    })}`,
  );
}

/** 执行带预算的召回并落审计。 */
export function recallMemory(input: {
  projectId: string;
  query: string;
  budgetTokens?: number;
}): Promise<{ hits: MemoryHit[]; total: number; record: RecallAudit }> {
  return request('/api/v1/memory/recall', { method: 'POST', body: JSON.stringify(input) });
}
