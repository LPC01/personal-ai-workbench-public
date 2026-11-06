/**
 * 工具参数/返回值脱敏（26 SPEC §16 SEC-004：Secret 不得进入 SQLite、日志、Prompt、Artifact 或 Memory）。
 *
 * 在工具调用/结果写入事件流之前，递归脱敏疑似秘密的值。
 */

/** 键名命中即整体掩码（密钥类字段名）。 */
const SECRET_KEY =
  /(password|passwd|secret|token|api[_-]?key|credential|authorization|private[_-]?key|access[_-]?key)/i;

/** 值形态疑似秘密（常见密钥前缀 / 高熵 hex / base64 / JWT）。 */
function looksLikeSecret(value: string): boolean {
  if (/^(sk-|Bearer |ghp_|gho_|xox[bap]-|AKIA[0-9A-Z]{16})/i.test(value)) {
    return true;
  }
  if (/^eyJ[A-Za-z0-9._-]{16,}\.[A-Za-z0-9._-]{8,}/.test(value)) {
    return true;
  }
  if (/^[0-9a-f]{32,}$/i.test(value)) {
    return true;
  }
  return /^[A-Za-z0-9+/]{40,}={0,2}$/.test(value);
}

const MAX_DEPTH = 10;

/** 递归脱敏：命中密钥键名或疑似秘密值 → `***`。 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return '[redacted]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return looksLikeSecret(value) ? '***' : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? '***' : redactSecrets(item, depth + 1);
    }
    return out;
  }
  return value;
}
