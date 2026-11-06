/** 模型错误类别（26 SPEC §12：归一化超时、限流、鉴权、上下文超限和结构化输出错误）。 */
export type ModelErrorKind =
  | 'timeout'
  | 'rate_limit'
  | 'auth'
  | 'context_overflow'
  | 'structured_output'
  | 'provider'
  | 'network';

/** 归一化后的模型错误：原始 Provider 错误不暴露凭据/完整敏感输入。 */
export class ModelError extends Error {
  readonly kind: ModelErrorKind;
  readonly status?: number;

  constructor(kind: ModelErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ModelError';
    this.kind = kind;
    this.status = status;
  }
}

/** 把原始错误 + HTTP 状态归一化为统一错误类别。 */
export function normalizeModelError(err: unknown, status?: number): ModelError {
  if (err instanceof ModelError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);

  if (status === 401 || status === 403) {
    return new ModelError('auth', message, status);
  }
  if (status === 429) {
    return new ModelError('rate_limit', message, status);
  }
  if (/context|maximum context|token limit|too long/i.test(message)) {
    return new ModelError('context_overflow', message, status);
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return new ModelError('timeout', message, status);
  }
  if (status === 408 || status === 504) {
    return new ModelError('timeout', message, status);
  }
  if (status !== undefined && status >= 400) {
    return new ModelError('provider', message, status);
  }
  return new ModelError('network', message, status);
}

/** 结构化输出解析：JSON.parse 失败归为 structured_output 错误。 */
export function parseStructuredOutput(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new ModelError('structured_output', '模型输出不是合法 JSON');
  }
}
