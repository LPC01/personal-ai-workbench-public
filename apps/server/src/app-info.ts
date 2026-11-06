import { WORKBENCH_VERSION } from './diagnostics-service.js';
import type { DataDirConfig } from './data-dir.js';

/** 应用信息（P8-06：供安装/升级/卸载与数据保留引用）。 */
export interface AppInfo {
  version: string;
  dataDir: string;
  dbPath: string;
  artifactsPath: string;
}

export function buildAppInfo(dataDirConfig: DataDirConfig): AppInfo {
  return {
    version: WORKBENCH_VERSION,
    dataDir: dataDirConfig.dataDir,
    dbPath: dataDirConfig.dbPath,
    artifactsPath: dataDirConfig.artifactsPath,
  };
}
