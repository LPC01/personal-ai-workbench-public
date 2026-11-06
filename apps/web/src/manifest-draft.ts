/**
 * 登记表单 → manifest 的纯逻辑（S1「表单/向导」模式，26 SPEC §5）。
 *
 * 定位（为什么这样切）：
 * - 表单只是「产出 manifest 的一种方式」；产物仍提交给既有
 *   `POST /api/v1/projects/register`，服务端的 Schema 校验 / 登记根约束 /
 *   id·root 唯一性校验**一条不减**。本模块的校验只用于即时反馈，不是准入判定。
 * - `schemas/project.schema.json` 是 `additionalProperties: false`，所以
 *   `buildManifest` 只输出**已启用**的区块，绝不留空对象 / 空字符串字段
 *   （否则会被判 422 MANIFEST_INVALID）。
 * - 本模块不碰 React / DOM，便于单测（根 vitest 的 include 已覆盖 apps 下的测试文件）。
 */

/** manifest 契约 ID（26 SPEC §5；与 schemas/project.schema.json 的 const 一致）。 */
export const PROJECT_SCHEMA_ID = 'workbench.project/v1';

export type ManifestCommandType = 'service' | 'job';
export type ManifestConcurrency = 'singleton' | 'parallel';
export type ManifestDisplayMode = 'external' | 'proxy' | 'embedded';

/** 表单字段全集（与实用档对齐：必填 4 项 + 端口段 / 单个启动命令 / Web UI）。 */
export interface ManifestDraft {
  id: string;
  name: string;
  description: string;
  root: string;

  portEnabled: boolean;
  portFrom: string;
  portTo: string;
  portEnvVar: string;

  commandEnabled: boolean;
  commandId: string;
  commandType: ManifestCommandType;
  commandExecutable: string;
  commandArguments: string;
  commandConcurrency: ManifestConcurrency;

  webUIEnabled: boolean;
  webUIDisplayMode: ManifestDisplayMode;
  webUIHealthUrl: string;
  webUIHealthTimeout: string;
}

export const ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const ENV_VAR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 初始草稿：三个可选区块默认**启用**并预填常见取值（Node 静态服务），
 * 使「填完必填 4 项」即得到一个「可启动、可进入 Web UI」的项目。
 * 取值均可在表单里改；登记本身不会执行任何命令。
 */
export function emptyDraft(): ManifestDraft {
  return {
    id: '',
    name: '',
    description: '',
    root: '',

    portEnabled: true,
    portFrom: '8100',
    portTo: '8109',
    portEnvVar: 'PORT',

    commandEnabled: true,
    commandId: 'start',
    commandType: 'service',
    commandExecutable: 'node',
    commandArguments: 'server.mjs',
    commandConcurrency: 'singleton',

    webUIEnabled: true,
    webUIDisplayMode: 'proxy',
    webUIHealthUrl: 'http://127.0.0.1:${port}/',
    webUIHealthTimeout: '30',
  };
}

/** 绝对路径判定：Windows 盘符（`D:/`、`D:\`）、UNC（`\\host\share`）、POSIX（`/`）。 */
export function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\');
}

/** 端口：1–65535 的整数；不合法返回 null。 */
function parsePort(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/** 正整数（≥1）；不合法返回 null。 */
function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** 参数文本 → 数组：按空白（含换行）切分，忽略空段。不解析引号（保持简单可预期）。 */
export function parseArguments(value: string): string[] {
  return value
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 本地校验（即时反馈用；不替代服务端校验）。返回逐条中文提示，空数组 = 本地通过。
 */
export function validateDraft(draft: ManifestDraft): string[] {
  const errors: string[] = [];

  const id = draft.id.trim();
  if (id.length === 0) errors.push('项目 ID 必填');
  else if (!ID_PATTERN.test(id)) {
    errors.push('项目 ID 需为 ^[a-z][a-z0-9-]{2,63}$：小写字母开头，可含小写字母 / 数字 / 连字符');
  }

  if (draft.name.trim().length === 0) errors.push('项目名称必填');

  const root = draft.root.trim();
  if (root.length === 0) errors.push('项目根目录必填');
  else if (!isAbsolutePath(root)) errors.push('项目根目录必须是绝对路径（如 C:/Projects/my-app）');

  if (draft.portEnabled) {
    const from = parsePort(draft.portFrom);
    const to = parsePort(draft.portTo);
    if (from === null) errors.push('端口段起点需为 1–65535 的整数');
    if (to === null) errors.push('端口段终点需为 1–65535 的整数');
    if (from !== null && to !== null && from > to) errors.push('端口段起点不能大于终点');
    const envVar = draft.portEnvVar.trim();
    if (envVar.length > 0 && !ENV_VAR_PATTERN.test(envVar)) {
      errors.push('端口环境变量名不合法（应为 PORT 这类标识符）');
    }
  }

  if (draft.commandEnabled) {
    if (draft.commandId.trim().length === 0) errors.push('启动命令 ID 必填');
    if (draft.commandExecutable.trim().length === 0) errors.push('启动命令的可执行文件必填');
  }

  if (draft.webUIEnabled) {
    const url = draft.webUIHealthUrl.trim();
    if (url.length > 0 && !/^https?:\/\//i.test(url)) {
      errors.push('健康检查 URL 需以 http:// 或 https:// 开头');
    }
    const timeout = draft.webUIHealthTimeout.trim();
    if (timeout.length > 0 && parsePositiveInt(timeout) === null) {
      errors.push('健康检查超时需为 ≥1 的整数（秒）');
    }
  }

  return errors;
}

/**
 * 组装 manifest：只输出已启用且非空的区块（对齐 `additionalProperties: false`）。
 */
export function buildManifest(draft: ManifestDraft): Record<string, unknown> {
  const project: Record<string, unknown> = {
    id: draft.id.trim(),
    name: draft.name.trim(),
  };
  const description = draft.description.trim();
  if (description.length > 0) project.description = description;

  const runtime: Record<string, unknown> = { root: draft.root.trim() };
  if (draft.portEnabled) {
    const port: Record<string, unknown> = {
      strategy: 'dynamic',
      from: parsePort(draft.portFrom),
      to: parsePort(draft.portTo),
    };
    const envVar = draft.portEnvVar.trim();
    if (envVar.length > 0) port.environmentVariable = envVar;
    runtime.port = port;
  }

  const manifest: Record<string, unknown> = {
    schemaVersion: PROJECT_SCHEMA_ID,
    project,
    runtime,
  };

  const commandId = draft.commandId.trim();
  if (draft.commandEnabled) {
    const command: Record<string, unknown> = {
      id: commandId,
      type: draft.commandType,
      executable: draft.commandExecutable.trim(),
    };
    const args = parseArguments(draft.commandArguments);
    if (args.length > 0) command.arguments = args;
    command.concurrency = draft.commandConcurrency;
    manifest.commands = [command];
  }

  if (draft.webUIEnabled) {
    const webUI: Record<string, unknown> = {
      enabled: true,
      displayMode: draft.webUIDisplayMode,
    };
    // startCommandId 只在确有该命令时写入，避免悬空引用。
    if (draft.commandEnabled && commandId.length > 0) webUI.startCommandId = commandId;
    const url = draft.webUIHealthUrl.trim();
    if (url.length > 0) {
      const healthCheck: Record<string, unknown> = { type: 'http', url };
      const timeout = parsePositiveInt(draft.webUIHealthTimeout.trim());
      if (timeout !== null) healthCheck.timeoutSeconds = timeout;
      webUI.healthCheck = healthCheck;
    }
    manifest.webUI = webUI;
  }

  return manifest;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** 转字符串：string / number 保留，其余返回 undefined。 */
function asStr(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * manifest → 表单草稿（尽力而为）。
 *
 * 只映射表单覆盖的字段；**未覆盖的区块**（models / memory / 多命令 /
 * webUI.url / webUI.stopCommandId 等）不会进入表单，切换后再切回 JSON 会丢失，
 * 故另由 `detectUnmappedBlocks` 提示。任何异常输入都安全退回默认草稿。
 */
export function draftFromManifest(input: unknown): ManifestDraft {
  const base = emptyDraft();
  const m = asRecord(input);
  const project = asRecord(m.project);
  const runtime = asRecord(m.runtime);
  const port = asRecord(runtime.port);
  const portEnabled = Object.keys(port).length > 0;
  const commands = Array.isArray(m.commands) ? m.commands : [];
  const first = asRecord(commands[0]);
  const commandEnabled = commands.length > 0;
  const webUI = asRecord(m.webUI);
  const webUIEnabled = Object.keys(webUI).length > 0;
  const healthCheck = asRecord(webUI.healthCheck);
  const rawArgs: unknown[] = Array.isArray(first.arguments) ? first.arguments : [];

  return {
    id: asStr(project.id) ?? base.id,
    name: asStr(project.name) ?? base.name,
    description: asStr(project.description) ?? base.description,
    root: asStr(runtime.root) ?? base.root,

    portEnabled,
    // 端口存在时忠实取值（缺失即空），避免往返时被塞入并不存在的字段。
    portFrom: portEnabled ? (asStr(port.from) ?? '') : base.portFrom,
    portTo: portEnabled ? (asStr(port.to) ?? '') : base.portTo,
    portEnvVar: portEnabled ? (asStr(port.environmentVariable) ?? '') : base.portEnvVar,

    commandEnabled,
    commandId: commandEnabled ? (asStr(first.id) ?? '') : base.commandId,
    commandType: first.type === 'job' ? 'job' : 'service',
    commandExecutable: commandEnabled ? (asStr(first.executable) ?? '') : base.commandExecutable,
    commandArguments: commandEnabled
      ? rawArgs.filter((a): a is string => typeof a === 'string').join(' ')
      : base.commandArguments,
    commandConcurrency: first.concurrency === 'parallel' ? 'parallel' : 'singleton',

    webUIEnabled,
    webUIDisplayMode:
      webUI.displayMode === 'external' || webUI.displayMode === 'embedded'
        ? webUI.displayMode
        : 'proxy',
    webUIHealthUrl: webUIEnabled ? (asStr(healthCheck.url) ?? '') : base.webUIHealthUrl,
    webUIHealthTimeout: webUIEnabled
      ? (asStr(healthCheck.timeoutSeconds) ?? '')
      : base.webUIHealthTimeout,
  };
}

/**
 * 检出表单**不覆盖**的区块名，用于在 JSON → 表单切换前提示「会丢字段」。
 */
export function detectUnmappedBlocks(input: unknown): string[] {
  const m = asRecord(input);
  const found: string[] = [];
  if (m.models !== undefined) found.push('models');
  if (m.memory !== undefined) found.push('memory');
  if (Array.isArray(m.commands) && m.commands.length > 1) {
    found.push(`多命令（${m.commands.length} 条）`);
  }
  const webUI = asRecord(m.webUI);
  if (webUI.url !== undefined) found.push('webUI.url');
  if (webUI.stopCommandId !== undefined) found.push('webUI.stopCommandId');
  for (const key of Object.keys(asRecord(m.runtime))) {
    if (key !== 'root' && key !== 'port') found.push(`runtime.${key}`);
  }
  return found;
}
