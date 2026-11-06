import { describe, expect, it } from 'vitest';
import { MemoryWriteGuard, scanPii, scanSecrets } from '../secret-pii-scanner.js';

/** 测试语料：Secret/PII 样本 + 正常样本。 */
const SECRET_SAMPLES = [
  'sk-abcdefghijklmnop123456',
  'ghp_0123456789abcdef0123456789abcdef0123',
  'AKIAIOSFODNN7EXAMPLE',
  'Bearer eyJhbGciOiJIUzI1NiJ9.abcdef',
  '-----BEGIN PRIVATE KEY-----\nxyz',
  'password=hunter2secret',
];

const PII_SAMPLES = ['user@example.com', '13800138000', '11010519491231002X'];

const CLEAN_SAMPLES = ['会议纪要：数据交换空间', '这是一个普通经验总结', 'today we learned'];

describe('Secret/PII 预过滤（§14.3）', () => {
  it('Secret 样本全部命中', () => {
    for (const sample of SECRET_SAMPLES) {
      expect(scanSecrets(sample).length, sample).toBeGreaterThan(0);
    }
  });

  it('PII 样本全部命中', () => {
    for (const sample of PII_SAMPLES) {
      expect(scanPii(sample).length, sample).toBeGreaterThan(0);
    }
  });

  it('正常样本不命中', () => {
    for (const sample of CLEAN_SAMPLES) {
      expect(scanSecrets(sample)).toHaveLength(0);
      expect(scanPii(sample)).toHaveLength(0);
    }
  });

  it('MemoryWriteGuard 拒绝 Secret/PII，放行正常', () => {
    const guard = new MemoryWriteGuard();
    expect(guard.check('sk-abcdefghijklmnop123456').ok).toBe(false);
    expect(guard.check('user@example.com').ok).toBe(false);
    expect(guard.check('会议纪要：数据交换空间').ok).toBe(true);
  });

  it('assertWritable 抛 MEMORY_SECRET_REJECTED', () => {
    const guard = new MemoryWriteGuard();
    expect(() => guard.assertWritable('api_key=sk-live-123456789')).toThrow(
      /MEMORY_SECRET_REJECTED|记忆写入被拒绝/,
    );
    guard.assertWritable('正常内容');
  });
});
