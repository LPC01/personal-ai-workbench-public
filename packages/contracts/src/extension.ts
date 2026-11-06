/**
 * Extension 契约（26 SPEC §6）。
 * 发布版本内容寻址且不可变；升级必须生成新版本和权限差异。
 */

/** workbench.extension/v1 契约 ID。 */
export const EXTENSION_SCHEMA_ID = 'workbench.extension/v1';

export type ExtensionType = 'assistant' | 'workflow';
export type ExtensionInstallScope = 'global' | 'project';

/** 扩展权限声明（§6：未声明路径/命令/模型/凭据必须拒绝）。 */
export interface ExtensionPermissions {
  files: {
    read: string[];
    write: string[];
  };
  commands: string[];
  network: boolean;
  credentials: string[];
}

export interface ExtensionModelConfig {
  defaultProfileId: string;
  allowedProfileIds?: string[];
  requirements?: {
    structuredOutput?: boolean;
    minimumContextTokens?: number;
  };
  cloudFallback?: {
    enabled: boolean;
  };
}

export interface ExtensionEntrypoint {
  type: string;
  id: string;
  label?: string;
}

/** workbench.extension/v1 Manifest。 */
export interface ExtensionSpec {
  schemaVersion: 'workbench.extension/v1';
  extension: {
    id: string;
    name: string;
    /** SemVer。 */
    version: string;
    types: ExtensionType[];
  };
  scope: {
    install: ExtensionInstallScope;
    run: 'project';
  };
  permissions: ExtensionPermissions;
  model?: ExtensionModelConfig;
  entrypoints?: ExtensionEntrypoint[];
}

/** 权限差异（26 SPEC §6：升级必须生成权限差异，权限扩大必须重新批准）。 */
export interface PermissionDiff {
  addedRead: string[];
  addedWrite: string[];
  addedCommands: string[];
  addedCredentials: string[];
  /** network 由 false → true。 */
  networkEnabled: boolean;
  /** 是否存在权限扩大（任一维度新增）。 */
  expanded: boolean;
}

/** 计算 from → to 的权限差异。 */
export function computePermissionDiff(
  from: ExtensionPermissions,
  to: ExtensionPermissions,
): PermissionDiff {
  const addedRead = to.files.read.filter((p) => !from.files.read.includes(p));
  const addedWrite = to.files.write.filter((p) => !from.files.write.includes(p));
  const addedCommands = to.commands.filter((c) => !from.commands.includes(c));
  const addedCredentials = to.credentials.filter((c) => !from.credentials.includes(c));
  const networkEnabled = !from.network && to.network;
  const expanded =
    addedRead.length > 0 ||
    addedWrite.length > 0 ||
    addedCommands.length > 0 ||
    addedCredentials.length > 0 ||
    networkEnabled;
  return { addedRead, addedWrite, addedCommands, addedCredentials, networkEnabled, expanded };
}
