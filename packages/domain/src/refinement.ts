/**
 * 记忆提炼纯逻辑（29 号 SPEC §17 记忆与问题闭环）。
 * domain 包保持纯净，不依赖 contracts。
 */

/** Secret/PII 脱敏模式（简化：常见密钥/令牌/私钥形态）。 */
const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'API Key', pattern: /\b(sk|api[_-]?key|token|secret)[-_][A-Za-z0-9]{16,}\b/gi },
  { name: 'Bearer Token', pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/g },
  {
    name: 'Private Key',
    pattern:
      /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g,
  },
  { name: 'Password', pattern: /\b(password|passwd|pwd)\s*[:=]\s*\S+/gi },
];

export interface ScrubResult {
  cleaned: string;
  redacted: string[];
}

/** Secret/PII 脱敏（§17：提炼前必须脱敏）。返回清理后文本与命中的类型。 */
export function scrubSecrets(text: string): ScrubResult {
  const redacted: string[] = [];
  let cleaned = text;
  for (const { name, pattern } of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, () => {
      redacted.push(name);
      return '[REDACTED]';
    });
  }
  return { cleaned, redacted };
}

/** Candidate 来源（§17：必须带 RoomRun、Event、Artifact、Decision 来源）。 */
export interface CandidateSource {
  roomRunId: string;
  eventId?: number;
  artifactId?: string;
  decisionId?: string;
}

/** 来源验证：Candidate 至少带 RoomRun 来源。返回错误或 null。 */
export function validateCandidateSource(source: CandidateSource): string | null {
  if (!source.roomRunId) return 'Candidate 必须带 RoomRun 来源';
  const hasDetail =
    source.eventId !== undefined ||
    source.artifactId !== undefined ||
    source.decisionId !== undefined;
  return hasDetail ? null : 'Candidate 必须带 Event/Artifact/Decision 之一的具体来源';
}
