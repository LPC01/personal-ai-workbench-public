/**
 * 备份与恢复（P8-04：26 SPEC §20）。
 * 备份包含 SQLite 一致性快照、Manifest、已安装扩展、Artifact 索引、Memory 导出和配置；不含明文 Credential。
 */

export const BACKUP_SCHEMA_VERSION = 'workbench.backup/v1';

export interface BackupFileEntry {
  name: string;
  sha256: string;
  sizeBytes: number;
}

export interface BackupManifest {
  schemaVersion: string;
  version: string;
  createdAt: string;
  files: BackupFileEntry[];
}

export interface BackupResult {
  dir: string;
  manifest: BackupManifest;
}

export interface BackupMismatch {
  name: string;
  expected: string;
  actual: string;
}

export interface BackupVerification {
  ok: boolean;
  checked: number;
  mismatches: BackupMismatch[];
}
