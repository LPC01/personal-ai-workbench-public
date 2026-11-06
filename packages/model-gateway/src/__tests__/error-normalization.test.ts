import { describe, expect, it } from 'vitest';
import { ModelError, normalizeModelError, parseStructuredOutput } from '../error-normalization.js';

describe('normalizeModelError', () => {
  it('maps 401/403 to auth', () => {
    expect(normalizeModelError(new Error('x'), 401).kind).toBe('auth');
    expect(normalizeModelError(new Error('x'), 403).kind).toBe('auth');
  });

  it('maps 429 to rate_limit', () => {
    expect(normalizeModelError(new Error('x'), 429).kind).toBe('rate_limit');
  });

  it('maps context-overflow message', () => {
    expect(normalizeModelError(new Error('maximum context length exceeded')).kind).toBe(
      'context_overflow',
    );
  });

  it('maps AbortError to timeout', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(normalizeModelError(err).kind).toBe('timeout');
  });

  it('maps other >=400 to provider', () => {
    expect(normalizeModelError(new Error('x'), 500).kind).toBe('provider');
    expect(normalizeModelError(new Error('x'), 404).kind).toBe('provider');
  });

  it('maps otherwise to network', () => {
    expect(normalizeModelError(new Error('ECONNREFUSED')).kind).toBe('network');
  });

  it('preserves an existing ModelError', () => {
    const err = new ModelError('rate_limit', 'limited', 429);
    expect(normalizeModelError(err)).toBe(err);
  });
});

describe('parseStructuredOutput', () => {
  it('parses valid JSON', () => {
    expect(parseStructuredOutput('{"a":1}')).toEqual({ a: 1 });
  });

  it('throws structured_output on invalid JSON', () => {
    expect(() => parseStructuredOutput('not json')).toThrowError(
      expect.objectContaining({ kind: 'structured_output' }),
    );
  });
});
