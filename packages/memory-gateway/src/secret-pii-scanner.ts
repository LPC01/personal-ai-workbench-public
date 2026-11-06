import { AppError } from '@workbench/domain';

/**
 * Secret/PII 预过滤（26 SPEC §14.3：写入前执行 Secret/PII 扫描；
 * API Key/Token/密码/私钥/完整环境变量必须拒绝）。
 */

/** 常见密钥形态。 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /gho_[A-Za-z0-9]{36}/g,
  /AKIA[0-9A-Z]{16}/g,
  /Bearer [A-Za-z0-9._~+=-]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*\S+/gi,
];

/** PII 形态（邮箱/手机号/身份证号）。 */
const PII_PATTERNS: RegExp[] = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /1[3-9]\d{9}/g,
  /\b\d{17}[\dXx]\b/g,
];

export function scanSecrets(content: string): string[] {
  const found: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    for (const m of content.match(pattern) ?? []) {
      found.push(m);
    }
  }
  return found;
}

export function scanPii(content: string): string[] {
  const found: string[] = [];
  for (const pattern of PII_PATTERNS) {
    for (const m of content.match(pattern) ?? []) {
      found.push(m);
    }
  }
  return found;
}

export interface WriteGuardResult {
  ok: boolean;
  reason?: 'secret' | 'pii';
}

/**
 * Memory 写入守卫（§14.3）：写入前 Secret/PII 预过滤。
 * 命中 Secret/PII 时抛 `MEMORY_SECRET_REJECTED`，不记录秘密本身。
 */
export class MemoryWriteGuard {
  check(content: string): WriteGuardResult {
    if (scanSecrets(content).length > 0) {
      return { ok: false, reason: 'secret' };
    }
    if (scanPii(content).length > 0) {
      return { ok: false, reason: 'pii' };
    }
    return { ok: true };
  }

  /** 断言可写入；否则抛 MEMORY_SECRET_REJECTED。 */
  assertWritable(content: string): void {
    const result = this.check(content);
    if (!result.ok) {
      throw new AppError('MEMORY_SECRET_REJECTED', `记忆写入被拒绝：${result.reason}`, {
        details: { reason: result.reason },
      });
    }
  }
}
