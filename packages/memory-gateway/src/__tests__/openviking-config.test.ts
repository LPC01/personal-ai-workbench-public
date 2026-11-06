import { describe, expect, it } from 'vitest';
import { OpenVikingAdapter } from '../openviking-adapter.js';
import {
  assertPinnedVersion,
  defaultOpenVikingConfig,
  resolveOpenVikingDataDir,
} from '../openviking-config.js';

describe('OpenViking 独立部署 + 版本锁定（SEC-013）', () => {
  it('版本锁定校验：匹配通过，漂移拒绝', () => {
    expect(assertPinnedVersion('0.4.0')).toBe(true);
    expect(assertPinnedVersion('0.5.0')).toBe(false);
  });

  it('独立数据目录按版本隔离', () => {
    expect(resolveOpenVikingDataDir('/base')).toContain('openviking-0.4.0');
  });

  it('默认配置：锁定版本 + 独立数据目录 + 只读', () => {
    const cfg = defaultOpenVikingConfig('/data');
    expect(cfg.pinnedVersion).toBe('0.4.0');
    expect(cfg.dataDir).toContain('openviking-0.4.0');
    expect(cfg.readOnly).toBe(true);
  });

  it('OpenVikingAdapter 绑定锁定版本 + dataDir + 默认端口', async () => {
    const adapter = new OpenVikingAdapter({ dataDir: '/data/openviking-0.4.0' });
    expect(adapter.pinnedVersion).toBe('0.4.0');
    expect(adapter.dataDir).toContain('openviking-0.4.0');
    expect(adapter.baseUrl).toBe('http://127.0.0.1:1933');
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(health.status).toBe('UNAVAILABLE');
  });
});
