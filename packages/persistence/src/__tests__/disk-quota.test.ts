import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertWithinDiskQuota, measureDirSize } from '../disk-quota.js';

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('disk-quota（P8-08 磁盘上限）', () => {
  it('measureDirSize 递归统计目录字节数', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-dq-'));
    tmpDirs.push(dir);
    writeFileSync(join(dir, 'a.bin'), Buffer.alloc(100));
    const nested = join(dir, 'sub');
    mkdirSync(nested);
    writeFileSync(join(nested, 'b.bin'), Buffer.alloc(50));
    expect(measureDirSize(dir)).toBe(150);
  });

  it('不存在的目录返回 0', () => {
    expect(measureDirSize(join(tmpdir(), 'no-such-dir-xyz'))).toBe(0);
  });

  it('未设上限时不抛错', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-dq-'));
    tmpDirs.push(dir);
    writeFileSync(join(dir, 'a.bin'), Buffer.alloc(100));
    expect(() => assertWithinDiskQuota(dir, 999999)).not.toThrow();
  });

  it('超限时抛 DISK_QUOTA_EXCEEDED', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-dq-'));
    tmpDirs.push(dir);
    writeFileSync(join(dir, 'a.bin'), Buffer.alloc(100));
    expect(() => assertWithinDiskQuota(dir, 50, 100)).toThrow(/磁盘配额超限/);
  });

  it('未超限时不抛错', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-dq-'));
    tmpDirs.push(dir);
    writeFileSync(join(dir, 'a.bin'), Buffer.alloc(100));
    expect(() => assertWithinDiskQuota(dir, 50, 200)).not.toThrow();
  });
});
