import { describe, expect, it } from 'vitest';
import { validateIframeMessage } from '../iframe-message.js';

describe('iframe 消息 Schema 校验（SEC-009 防伪造）', () => {
  it('合法消息通过', () => {
    const result = validateIframeMessage({
      source: 'meeting-minutes',
      type: 'render',
      payload: { title: '纪要' },
    });
    expect(result.valid).toBe(true);
  });

  it('拒绝非法类型', () => {
    const result = validateIframeMessage({ source: 'x', type: 'shell', payload: {} });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('type'))).toBe(true);
  });

  it('拒绝缺失 source', () => {
    const result = validateIframeMessage({ type: 'render', payload: {} });
    expect(result.valid).toBe(false);
  });

  it('拒绝非对象消息', () => {
    expect(validateIframeMessage('hello').valid).toBe(false);
    expect(validateIframeMessage(null).valid).toBe(false);
  });

  it('拒绝非对象 payload', () => {
    const result = validateIframeMessage({ source: 'x', type: 'render', payload: 'not-object' });
    expect(result.valid).toBe(false);
  });
});
