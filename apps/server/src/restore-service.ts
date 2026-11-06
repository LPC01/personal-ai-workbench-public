import { copyFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { AppError } from '@workbench/domain';
import type { BackupService } from './backup-service.js';

export interface RestoreResult {
  ok: boolean;
  verified: boolean;
  schemaTables: number;
  targetDbPath: string;
}

/**
 * 恢复服务（P8-05：26 SPEC §20）。
 * 恢复前必须先校验哈希；在临时目录验证快照后原子切换。
 */
export class RestoreService {
  constructor(private readonly backup: BackupService) {}

  restore(backupDir: string, targetDbPath: string): RestoreResult {
    // 1. 校验哈希
    const verification = this.backup.verifyBackup(backupDir);
    if (!verification.ok) {
      throw new AppError(
        'BACKUP_INVALID',
        `备份校验失败：${verification.mismatches.length} 处不匹配`,
        { details: { mismatches: verification.mismatches } },
      );
    }

    // 2. 临时验证快照（只读打开，确认 schema 完整）
    const sourceDb = join(backupDir, 'db.sqlite');
    const schemaTables = probeSnapshotTables(sourceDb);
    if (schemaTables === 0) {
      throw new AppError('BACKUP_INVALID', '备份快照无效（无表）', {});
    }

    // 3. 原子切换：先写临时文件，再 rename 到目标
    mkdirSync(dirname(targetDbPath), { recursive: true });
    const tmpTarget = `${targetDbPath}.restore-${Date.now()}.tmp`;
    copyFileSync(sourceDb, tmpTarget);
    renameSync(tmpTarget, targetDbPath);

    return { ok: true, verified: true, schemaTables, targetDbPath };
  }
}

function probeSnapshotTables(path: string): number {
  const probe = new Database(path, { readonly: true });
  try {
    const rows = probe.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
      name: string;
    }[];
    return rows.length;
  } finally {
    probe.close();
  }
}
