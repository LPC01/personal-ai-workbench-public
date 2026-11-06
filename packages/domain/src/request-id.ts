const PREFIX = 'req_';

/** 生成新的 request ID（`req_` 前缀 + UUID v4，使用 Web Crypto，不依赖平台模块）。 */
export function newRequestId(): string {
  return `${PREFIX}${crypto.randomUUID()}`;
}

export function isRequestId(value: string): boolean {
  return value.startsWith(PREFIX) && value.length > PREFIX.length;
}
