import { join } from 'node:path';

/**
 * OpenViking 独立部署配置（26 SPEC §16 SEC-013：OpenViking 和第三方 Sidecar
 * 使用独立数据目录与最小权限；§14.1：OpenViking Adapter 必须是实现之一）。
 */

/** 锁定的 OpenViking 版本（升级需显式变更 + 恢复演练）。 */
export const OPENVIKING_PINNED_VERSION = '0.4.0';

/** OpenViking HTTP 默认端口（docs.openviking.ai 官方默认）。 */
export const OPENVIKING_DEFAULT_PORT = 1933;
/** OpenViking 默认绑定回环地址。 */
export const OPENVIKING_DEFAULT_HOST = '127.0.0.1';

export interface OpenVikingConfig {
  /** 锁定的版本。 */
  pinnedVersion: string;
  /** HTTP 服务地址（host:port）。 */
  baseUrl: string;
  /** 独立数据目录（与 Host 数据隔离）。 */
  dataDir: string;
  /** 凭据引用（指向 CredentialStore，替代明文 api_key；可为空）。 */
  apiKeyRef: string | null;
  /** 最小权限：只读降级标记。 */
  readOnly: boolean;
}

/** 解析 OpenViking 独立数据目录（按锁定版本隔离）。 */
export function resolveOpenVikingDataDir(
  baseDir: string,
  version = OPENVIKING_PINNED_VERSION,
): string {
  return join(baseDir, `openviking-${version}`);
}

/** 校验实际版本与锁定版本一致（版本漂移防护）。 */
export function assertPinnedVersion(actual: string, pinned = OPENVIKING_PINNED_VERSION): boolean {
  return actual === pinned;
}

/** 默认配置（独立数据目录 + 只读降级 + 默认端口回环地址）。 */
export function defaultOpenVikingConfig(baseDir: string): OpenVikingConfig {
  return {
    pinnedVersion: OPENVIKING_PINNED_VERSION,
    baseUrl: `http://${OPENVIKING_DEFAULT_HOST}:${OPENVIKING_DEFAULT_PORT}`,
    dataDir: resolveOpenVikingDataDir(baseDir),
    apiKeyRef: null,
    readOnly: true,
  };
}
