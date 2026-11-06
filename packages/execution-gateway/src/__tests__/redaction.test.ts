import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../redaction.js';

describe('redactSecrets（SEC-004）', () => {
  it('掩码密钥类键名', () => {
    const out = redactSecrets({
      apiKey: 'sk-abcdef123456',
      password: 'hunter2',
      name: '普通字段',
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe('***');
    expect(out.password).toBe('***');
    expect(out.name).toBe('普通字段');
  });

  it('掩码疑似秘密的字符串值', () => {
    expect(redactSecrets('sk-abcdef123456789')).toBe('***');
    expect(redactSecrets('Bearer eyJhbGciOiJIUzI1NiJ9')).toBe('***');
    expect(redactSecrets('e4a1f2b3c4d5e6f7a8b9c0d1e2f3a4b5')).toBe('***');
    expect(redactSecrets('普通文本')).toBe('普通文本');
  });

  it('递归脱敏嵌套对象与数组', () => {
    const out = redactSecrets({
      list: [{ token: 'abc' }, { value: 'safe' }],
      nested: { config: { apiKey: 'x' } },
    }) as Record<string, unknown>;
    expect((out.list as unknown[])[0]).toEqual({ token: '***' });
    expect(out.nested).toEqual({ config: { apiKey: '***' } });
  });

  it('掩码整段 credential 类键名（含嵌套对象）', () => {
    const out = redactSecrets({ credentials: { apiKey: 'x', user: 'u' } }) as Record<
      string,
      unknown
    >;
    expect(out.credentials).toBe('***');
  });

  it('保留原始数字/布尔/空值', () => {
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(true)).toBe(true);
    expect(redactSecrets(null)).toBeNull();
  });
});
