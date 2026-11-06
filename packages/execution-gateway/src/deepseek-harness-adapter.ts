import { AppError } from '@workbench/domain';
import type {
  HarnessAdapter,
  HarnessEvent,
  HarnessHealth,
  HarnessRunRequest,
  HarnessRunResponse,
} from './harness-adapter.js';

/**
 * DeepSeek Harness Adapter（26 SPEC §13 + 设计 §6.9/§15）。
 *
 * DeepSeek Harness 作为 Execution Gateway 后的可替换 Agent 内核，通过 HTTP 暴露
 * 与 `HarnessAdapter` 契约一致的端点。本 Adapter 是平台侧的唯一入口，负责把
 * Harness 的响应归一化为 `HarnessEvent` / `HarnessRunResponse`，不把第三方对象暴露给上层。
 *
 * 端点约定（相对 `baseUrl`）：
 * - `GET  /health`  → `{ ok: boolean, detail?: string }`
 * - `POST /run`     → `HarnessRunResponse`
 * - `POST /stream`  → SSE（`text/event-stream`，每帧 `data: <HarnessEvent JSON>`）
 * - `POST /cancel`  → `{ sessionId }`
 *
 * `baseUrl` **必填**：缺失时构造即抛 `HARNESS_UNAVAILABLE`，不再静默落到默认地址
 * （旧默认值 `http://127.0.0.1:11434` 恰为 Ollama 端口，会让未配置的 profile 探测稳定 404
 * 且报错指向不清 —— 见 known-limitations #12）。
 */

interface DeepSeekConfig {
  baseUrl: string;
  timeoutSeconds: number;
}

function toConfig(config: Record<string, unknown>): DeepSeekConfig {
  const rawBaseUrl = config.baseUrl;
  if (typeof rawBaseUrl !== 'string' || rawBaseUrl.trim().length === 0) {
    throw new AppError(
      'HARNESS_UNAVAILABLE',
      'Harness Profile 缺少 baseUrl 配置（deepseek 类型必须显式指定 Harness 服务地址）',
      { details: { key: 'baseUrl' } },
    );
  }
  const timeoutSeconds = typeof config.timeoutSeconds === 'number' ? config.timeoutSeconds : 30;
  return { baseUrl: rawBaseUrl.trim().replace(/\/+$/, ''), timeoutSeconds };
}

export class DeepSeekHarnessAdapter implements HarnessAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: Record<string, unknown> = {}) {
    const parsed = toConfig(config);
    this.baseUrl = parsed.baseUrl;
    this.timeoutMs = parsed.timeoutSeconds * 1000;
  }

  async health(): Promise<HarnessHealth> {
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/health`, { method: 'GET' });
      if (!res.ok) {
        return { ok: false, detail: `HTTP ${res.status}` };
      }
      const body = (await res.json()) as { ok?: boolean; detail?: string };
      return { ok: body.ok !== false, detail: body.detail };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'unreachable' };
    }
  }

  async run(request: HarnessRunRequest): Promise<HarnessRunResponse> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      throw new Error(`Harness HTTP ${res.status}`);
    }
    return (await res.json()) as HarnessRunResponse;
  }

  async *stream(request: HarnessRunRequest): AsyncIterable<HarnessEvent> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      throw new Error(`Harness HTTP ${res.status}`);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      return;
    }
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (payload) yield JSON.parse(payload) as HarnessEvent;
          }
          newlineIndex = buffer.indexOf('\n');
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (!res.ok) {
      throw new Error(`Harness HTTP ${res.status}`);
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
