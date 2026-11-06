import { normalizeModelError, parseStructuredOutput } from './error-normalization.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  /** 模型 ID（如 qwen-local / gpt-4o-mini）。 */
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResponse {
  content: string;
  usage?: ChatUsage;
}

export interface ChatChunk {
  content: string;
  done: boolean;
}

/** 模型 Provider Adapter（26 SPEC §12）：统一的对话调用契约。 */
export interface ModelAdapter {
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** 流式调用：逐块产出内容。 */
  stream(request: ChatRequest): AsyncIterable<ChatChunk>;
  /** 结构化输出：请求 JSON 并解析为 T。 */
  chatJson<T>(request: ChatRequest): Promise<T>;
}

/** 逐行读取流式响应体（处理跨 chunk 的换行拆分）。 */
async function* readLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      yield line;
    }
  }
  if (buffer) {
    yield buffer;
  }
}

/**
 * OpenAI-compatible Adapter（26 SPEC §12「统一云端兼容 API」）。
 * 调用 `POST {baseUrl}/chat/completions`；apiKey 由上层经 CredentialStore 解析后传入。
 */
export class OpenAICompatibleAdapter implements ModelAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      ...extra,
    };
  }

  private body(request: ChatRequest, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 1024,
      ...extra,
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(request),
    });

    if (!res.ok) {
      throw normalizeModelError(new Error(`HTTP ${res.status}`), res.status);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
        }
      : undefined;

    return { content, usage };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(request, { stream: true }),
    });

    if (!res.ok) {
      throw normalizeModelError(new Error(`HTTP ${res.status}`), res.status);
    }

    for await (const line of readLines(res.body as ReadableStream<Uint8Array>)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') {
        return;
      }
      const obj = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      const delta = obj.choices?.[0]?.delta?.content ?? '';
      if (delta) {
        yield { content: delta, done: false };
      }
    }
    yield { content: '', done: true };
  }

  async chatJson<T>(request: ChatRequest): Promise<T> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(request, { response_format: { type: 'json_object' } }),
    });
    if (!res.ok) {
      throw normalizeModelError(new Error(`HTTP ${res.status}`), res.status);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseStructuredOutput(data.choices?.[0]?.message?.content ?? '') as T;
  }
}

/**
 * Ollama / local Adapter（26 SPEC §12「本地 Ollama 类服务」）。
 * 调用 `POST {baseUrl}/api/chat`，无鉴权；maxTokens 映射到 `options.num_predict`。
 */
export class OllamaAdapter implements ModelAdapter {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private options(request: ChatRequest): Record<string, unknown> {
    const options: Record<string, unknown> = { temperature: request.temperature ?? 0.7 };
    if (request.maxTokens !== undefined) {
      options.num_predict = request.maxTokens;
    }
    return options;
  }

  private body(request: ChatRequest, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      model: request.model,
      messages: request.messages,
      stream: false,
      options: this.options(request),
      ...extra,
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: this.body(request),
    });

    if (!res.ok) {
      throw normalizeModelError(new Error(`HTTP ${res.status}`), res.status);
    }

    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const content = data.message?.content ?? '';
    const usage =
      data.prompt_eval_count !== undefined
        ? { promptTokens: data.prompt_eval_count, completionTokens: data.eval_count ?? 0 }
        : undefined;

    return { content, usage };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...JSON.parse(this.body(request)), stream: true }),
    });

    if (!res.ok) {
      throw normalizeModelError(new Error(`HTTP ${res.status}`), res.status);
    }

    for await (const line of readLines(res.body as ReadableStream<Uint8Array>)) {
      if (!line.trim()) {
        continue;
      }
      const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
      const delta = obj.message?.content ?? '';
      if (delta) {
        yield { content: delta, done: false };
      }
      if (obj.done) {
        return;
      }
    }
    yield { content: '', done: true };
  }

  async chatJson<T>(request: ChatRequest): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: this.body(request, { format: 'json' }),
    });
    if (!res.ok) {
      throw normalizeModelError(new Error(`HTTP ${res.status}`), res.status);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return parseStructuredOutput(data.message?.content ?? '') as T;
  }
}
