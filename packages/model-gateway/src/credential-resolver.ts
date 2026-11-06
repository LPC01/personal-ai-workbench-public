import type { ModelProvider } from '@workbench/contracts';
import { OllamaAdapter, OpenAICompatibleAdapter, type ModelAdapter } from './adapter.js';
import type { CredentialStore } from './credential-store.js';

/**
 * 凭据解析（32 号 SPEC §3 CRED）：Provider 绑定 credentialRef 后，
 * 在调用 Provider 的最短生命周期内经 withSecret 解析出 apiKey。
 * Secret 只存在于解析结果字符串中，随后仅注入 Adapter 鉴权头，不落库/不记录。
 */
export async function resolveApiKey(
  provider: ModelProvider,
  credentialStore: CredentialStore,
): Promise<string | undefined> {
  if (!provider.credentialRef) {
    return undefined;
  }
  return credentialStore.withSecret(provider.credentialRef, 'model_auth', async (secret) => secret);
}

/** 依据 Provider 类型 + 已解析 apiKey 构建 Adapter。 */
export function buildAdapter(provider: ModelProvider, apiKey?: string): ModelAdapter {
  if (provider.type === 'ollama') {
    return new OllamaAdapter(provider.baseUrl ?? '');
  }
  return new OpenAICompatibleAdapter(provider.baseUrl ?? '', apiKey);
}

/** 从 Provider + credentialRef 解析并构建鉴权就绪的 Adapter。 */
export async function resolveAdapter(
  provider: ModelProvider,
  credentialStore: CredentialStore,
): Promise<ModelAdapter> {
  const apiKey = await resolveApiKey(provider, credentialStore);
  return buildAdapter(provider, apiKey);
}
