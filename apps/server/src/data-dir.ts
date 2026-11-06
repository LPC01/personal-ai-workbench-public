/**
 * 数据目录解析（P8-06：数据保留）。
 * 数据目录与程序目录分离，卸载程序时数据可保留。
 */

export interface DataDirConfig {
  /** 数据根目录（默认 `var`）。 */
  dataDir: string;
  /** SQLite 数据库路径。 */
  dbPath: string;
  /** Artifact 存储根目录。 */
  artifactsPath: string;
}

/**
 * 解析数据目录：优先级 环境变量 > 默认值。
 * - `WB_DATA_DIR`：数据根目录（默认 `var`）
 * - `WB_DB`：数据库路径（默认 `${dataDir}/workbench.db`）
 * - `WB_ARTIFACTS`：Artifact 根（默认 `${dataDir}/artifacts`）
 */
export function resolveDataDir(env: Record<string, string | undefined>): DataDirConfig {
  const dataDir = env.WB_DATA_DIR ?? 'var';
  const dbPath = env.WB_DB ?? `${dataDir}/workbench.db`;
  const artifactsPath = env.WB_ARTIFACTS ?? `${dataDir}/artifacts`;
  return { dataDir, dbPath, artifactsPath };
}
