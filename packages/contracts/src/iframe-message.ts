/**
 * 沙箱 iframe / MCP Apps 消息契约（26 SPEC §16 SEC-009：UI 扩展使用沙箱和消息 Schema）。
 * 防止 iframe 消息伪造（§18.4 安全测试）。
 */

export type IframeMessageType = 'ready' | 'render' | 'action';

/** 扩展 UI 与 Host 之间的 postMessage 消息。 */
export interface IframeMessage {
  /** 扩展 ID（来源标识，必须非空）。 */
  source: string;
  type: IframeMessageType;
  payload: Record<string, unknown>;
}

/** 允许的消息类型（白名单）。 */
export const IFRAME_MESSAGE_TYPES: readonly IframeMessageType[] = ['ready', 'render', 'action'];

export interface IframeMessageValidation {
  valid: boolean;
  issues: string[];
}

/** 校验 iframe 消息（结构 + 类型白名单 + payload 对象），防伪造。 */
export function validateIframeMessage(message: unknown): IframeMessageValidation {
  const issues: string[] = [];
  if (!message || typeof message !== 'object') {
    return { valid: false, issues: ['消息非对象'] };
  }
  const m = message as Partial<IframeMessage>;
  if (typeof m.source !== 'string' || m.source.length === 0) {
    issues.push('source 缺失或为空');
  }
  if (!IFRAME_MESSAGE_TYPES.includes(m.type as IframeMessageType)) {
    issues.push(`type 非法（允许: ${IFRAME_MESSAGE_TYPES.join('/')}）`);
  }
  if (m.payload !== undefined && (typeof m.payload !== 'object' || m.payload === null)) {
    issues.push('payload 需为对象');
  }
  return { valid: issues.length === 0, issues };
}
