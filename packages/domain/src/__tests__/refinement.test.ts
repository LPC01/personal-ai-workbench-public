import { describe, expect, it } from 'vitest';
import { scrubSecrets, validateCandidateSource } from '../refinement.js';

describe('scrubSecrets（§17 Secret/PII 脱敏）', () => {
  it('脱敏 API Key / Bearer Token / 密码', () => {
    const { cleaned, redacted } = scrubSecrets(
      'API key sk_abcdefghijklmnopqrstuvwxyz123456，Bearer abcdefghijklmnopqrstuvwxyz1234，password: hunter2',
    );
    expect(cleaned).not.toContain('sk_abcdefghijklmnopqrstuvwxyz123456');
    expect(cleaned).not.toContain('abcdefghijklmnopqrstuvwxyz1234');
    expect(cleaned).not.toContain('hunter2');
    expect(cleaned).toContain('[REDACTED]');
    expect(redacted.length).toBeGreaterThan(0);
  });

  it('无 Secret 时不脱敏', () => {
    const { cleaned, redacted } = scrubSecrets('这是普通内容，没有敏感信息');
    expect(cleaned).toBe('这是普通内容，没有敏感信息');
    expect(redacted).toEqual([]);
  });
});

describe('validateCandidateSource（§17 来源验证）', () => {
  it('缺 RoomRun 来源拒绝', () => {
    expect(validateCandidateSource({ roomRunId: '' })).toMatch(/RoomRun 来源/);
  });

  it('缺具体来源拒绝', () => {
    expect(validateCandidateSource({ roomRunId: 'run1' })).toMatch(/具体来源/);
  });

  it('带 Event/Artifact/Decision 来源通过', () => {
    expect(validateCandidateSource({ roomRunId: 'run1', artifactId: 'a1' })).toBeNull();
    expect(validateCandidateSource({ roomRunId: 'run1', decisionId: 'd1' })).toBeNull();
  });
});
