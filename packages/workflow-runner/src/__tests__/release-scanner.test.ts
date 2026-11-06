import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDependencyLock, generateSbom, scanRelease, scanSecrets } from '../release-scanner.js';

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('依赖锁 / SBOM / 许可证 / Secret 扫描（SEC-011）', () => {
  it('generateSbom 从 package.json 提取依赖与许可证', () => {
    const sbom = generateSbom({
      name: 'meeting-minutes',
      version: '0.1.0',
      license: 'MIT',
      dependencies: { lodash: '^4.17.21', fastify: '~5.0.0' },
    });
    expect(sbom.name).toBe('meeting-minutes');
    expect(sbom.license).toBe('MIT');
    expect(sbom.dependencies).toContainEqual({ name: 'fastify', version: '5.0.0' });
    expect(sbom.dependencies).toContainEqual({ name: 'lodash', version: '4.17.21' });
  });

  it('checkDependencyLock 识别 lockfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-scan-'));
    tmpDirs.push(dir);
    expect(checkDependencyLock(dir)).toBe(false);
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    expect(checkDependencyLock(dir)).toBe(true);
  });

  it('scanSecrets 命中常见密钥形态', () => {
    const findings = scanSecrets(
      'const key = "sk-abcdefghijklmnop123456"; const token = "ghp_0123456789abcdef0123456789abcdef0123";',
    );
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.some((f) => f.value.startsWith('sk-'))).toBe(true);
  });

  it('scanRelease 汇总依赖锁 + 许可证 + Secret', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-rel-'));
    tmpDirs.push(dir);
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    const result = scanRelease(dir, {
      name: 'x',
      version: '0.1.0',
      license: 'MIT',
      dependencies: { dep: '1.0.0' },
    });
    expect(result.dependencyLocked).toBe(true);
    expect(result.licenseDeclared).toBe(true);
    expect(result.sbom.dependencies).toHaveLength(1);
  });
});
