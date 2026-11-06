import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@workbench/domain';

/** 递归统计目录占用字节数（不存在返回 0）。 */
export function measureDirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += measureDirSize(path);
    } else {
      total += statSync(path).size;
    }
  }
  return total;
}

/**
 * 磁盘配额断言（P8-08）：写入前检查当前目录 + 新增字节是否超限。
 * `limitBytes` 为 undefined 表示无限制。
 */
export function assertWithinDiskQuota(
  dir: string,
  incomingBytes: number,
  limitBytes?: number,
): void {
  if (limitBytes === undefined) return;
  const used = measureDirSize(dir);
  if (used + incomingBytes > limitBytes) {
    throw new AppError('DISK_QUOTA_EXCEEDED', '磁盘配额超限', {
      details: { usedBytes: used, incomingBytes, limitBytes },
    });
  }
}
