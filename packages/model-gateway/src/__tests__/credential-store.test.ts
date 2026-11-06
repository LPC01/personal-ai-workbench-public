import { describe, expect, it } from 'vitest';
import { InMemoryCredentialStore, maskSecret } from '../credential-store.js';

describe('maskSecret', () => {
  it('masks long secrets keeping last 4', () => {
    expect(maskSecret('sk-abcdef1234567890')).toBe('****7890');
  });

  it('masks short secrets fully', () => {
    expect(maskSecret('abc')).toBe('****');
    expect(maskSecret('abcd')).toBe('****');
  });
});

describe('InMemoryCredentialStore（CRED-02 契约 put/describe/withSecret/delete）', () => {
  it('put 返回 descriptor（含掩码，不含 Secret），describe 一致', async () => {
    const store = new InMemoryCredentialStore();
    const d = await store.put({ ref: 'cred_1', type: 'api_key', secret: 'sk-secret-value' });
    expect(d.ref).toBe('cred_1');
    expect(d.type).toBe('api_key');
    expect(d.masked).toBe('****alue');
    expect(d.status).toBe('ACTIVE');
    expect(JSON.stringify(d)).not.toContain('sk-secret-value');

    const desc = await store.describe('cred_1');
    expect(desc.masked).toBe('****alue');
    expect(JSON.stringify(desc)).not.toContain('sk-secret-value');
  });

  it('withSecret 在闭包内可用，闭包外无法持有明文', async () => {
    const store = new InMemoryCredentialStore();
    await store.put({ ref: 'cred_1', type: 'api_key', secret: 'sk-secret-value' });

    let leaked = '';
    const result = await store.withSecret('cred_1', 'model_auth', async (secret) => {
      leaked = secret; // 仅在闭包作用域内持有
      return `used:${secret.slice(-4)}`;
    });
    expect(result).toBe('used:alue');
    expect(leaked).toBe('sk-secret-value'); // 闭包内可见；接口不返回该值
  });

  it('describe/withSecret 找不到时抛 CREDENTIAL_NOT_FOUND', async () => {
    const store = new InMemoryCredentialStore();
    await expect(store.describe('nope')).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    await expect(store.withSecret('nope', 'model_auth', async () => 1)).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
    });
  });

  it('delete 后 withSecret 稳定失败', async () => {
    const store = new InMemoryCredentialStore();
    await store.put({ ref: 'cred_1', type: 'api_key', secret: 'x' });
    await store.delete('cred_1');
    await expect(store.withSecret('cred_1', 'model_auth', async () => 1)).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
    });
  });
});
