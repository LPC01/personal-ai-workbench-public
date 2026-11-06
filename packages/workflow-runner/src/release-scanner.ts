import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** SBOM 依赖条目。 */
export interface SbomEntry {
  name: string;
  version: string;
}

/** SBOM 报告。 */
export interface SbomReport {
  name: string;
  version: string;
  license: string | null;
  dependencies: SbomEntry[];
}

/** Secret 命中。 */
export interface SecretFinding {
  pattern: string;
  value: string;
}

/** 发布扫描结果。 */
export interface ReleaseScanResult {
  dependencyLocked: boolean;
  sbom: SbomReport;
  licenseDeclared: boolean;
  secrets: SecretFinding[];
}

/** 常见密钥形态（SEC-004/SEC-011）。 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /gho_[A-Za-z0-9]{36}/g,
  /AKIA[0-9A-Z]{16}/g,
  /Bearer [A-Za-z0-9._~+=-]{20,}/g,
];

/** 从 package.json 生成 SBOM（依赖 + 版本 + 许可证）。 */
export function generateSbom(packageJson: Record<string, unknown>): SbomReport {
  const deps = {
    ...((packageJson.dependencies as Record<string, string>) ?? {}),
    ...((packageJson.devDependencies as Record<string, string>) ?? {}),
  };
  return {
    name: String(packageJson.name ?? 'unknown'),
    version: String(packageJson.version ?? '0.0.0'),
    license: typeof packageJson.license === 'string' ? packageJson.license : null,
    dependencies: Object.entries(deps)
      .map(([name, version]) => ({ name, version: String(version).replace(/^[\^~]/, '') }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** 检查依赖是否锁定（存在 lockfile）。 */
export function checkDependencyLock(root: string): boolean {
  return ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].some((f) =>
    existsSync(join(root, f)),
  );
}

/** 扫描内容中的疑似 Secret，返回命中（SEC-004/SEC-011）。 */
export function scanSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const matches = content.match(pattern);
    for (const value of matches ?? []) {
      findings.push({ pattern: pattern.source, value });
    }
  }
  return findings;
}

/** 发布扫描：依赖锁 + SBOM + 许可证 + Secret。 */
export function scanRelease(root: string, packageJson: Record<string, unknown>): ReleaseScanResult {
  const sbom = generateSbom(packageJson);
  const secrets = scanSecrets(JSON.stringify(packageJson));
  return {
    dependencyLocked: checkDependencyLock(root),
    sbom,
    licenseDeclared: sbom.license !== null && sbom.license.length > 0,
    secrets,
  };
}
