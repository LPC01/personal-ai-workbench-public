import type { ModelProviderType } from '@workbench/contracts';

export interface ProbeResult {
  healthy: boolean;
  models: string[];
  error?: string;
}

export interface ProbeOptions {
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * 探测 Provider（26 SPEC §10.4 `POST /model-providers/{id}/probe`）：
 * - Ollama：`GET {baseUrl}/api/tags` → `models[].name`
 * - OpenAI-compatible：`GET {baseUrl}/models` → `data[].id`
 * 带超时；失败返回 `{healthy:false, error}` 而不抛异常。
 */
export async function probeProvider(
  type: ModelProviderType,
  baseUrl: string | null | undefined,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const url = (baseUrl ?? '').replace(/\/+$/, '');
  if (!url) {
    return { healthy: false, models: [], error: '未配置 baseUrl' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  try {
    const endpoint = type === 'ollama' ? `${url}/api/tags` : `${url}/models`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) {
      return { healthy: false, models: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      models?: { name?: string }[];
      data?: { id?: string }[];
    };
    const models =
      type === 'ollama'
        ? (data.models ?? []).map((m) => m.name ?? '').filter(Boolean)
        : (data.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    return { healthy: true, models };
  } catch (err) {
    return { healthy: false, models: [], error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
