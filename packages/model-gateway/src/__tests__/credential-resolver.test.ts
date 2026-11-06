import { describe, expect, it } from 'vitest';
import type { ModelProvider } from '@workbench/contracts';
import { InMemoryCredentialStore } from '../credential-store.js';
import { buildAdapter, resolveAdapter, resolveApiKey } from '../credential-resolver.js';
import { OllamaAdapter, OpenAICompatibleAdapter } from '../adapter.js';

const provider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  id: 'prov_1',
  name: 'Test Provider',
  type: 'openai-compatible',
  baseUrl: 'http://localhost:8080/v1',
  credentialRef: null,
  revision: 1,
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
  ...overrides,
});

describe('credential-resolver（CRED-03）', () => {
  it('无 credentialRef 时 resolveApiKey 返回 undefined', async () => {
    const store = new InMemoryCredentialStore();
    expect(await resolveApiKey(provider(), store)).toBeUndefined();
  });

  it('有 credentialRef 时经 withSecret 解析出 apiKey', async () => {
    const store = new InMemoryCredentialStore();
    await store.put({ ref: 'cred_1', type: 'api_key', secret: 'sk-resolved-1234' });
    const apiKey = await resolveApiKey(provider({ credentialRef: 'cred_1' }), store);
    expect(apiKey).toBe('sk-resolved-1234');
  });

  it('credentialRef 不存在时抛 CREDENTIAL_NOT_FOUND', async () => {
    const store = new InMemoryCredentialStore();
    await expect(
      resolveApiKey(provider({ credentialRef: 'missing' }), store),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
  });

  it('buildAdapter：openai-compatible → OpenAICompatibleAdapter', () => {
    const adapter = buildAdapter(provider({ type: 'openai-compatible' }), 'sk-key');
    expect(adapter).toBeInstanceOf(OpenAICompatibleAdapter);
  });

  it('buildAdapter：ollama → OllamaAdapter', () => {
    const adapter = buildAdapter(provider({ type: 'ollama' }));
    expect(adapter).toBeInstanceOf(OllamaAdapter);
  });

  it('resolveAdapter 绑定 credentialRef 构建鉴权就绪 Adapter', async () => {
    const store = new InMemoryCredentialStore();
    await store.put({ ref: 'cred_1', type: 'api_key', secret: 'sk-1234' });
    const adapter = await resolveAdapter(provider({ credentialRef: 'cred_1' }), store);
    expect(adapter).toBeInstanceOf(OpenAICompatibleAdapter);
  });
});
