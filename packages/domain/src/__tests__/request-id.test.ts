import { describe, expect, it } from 'vitest';
import { isRequestId, newRequestId } from '../request-id.js';

describe('newRequestId', () => {
  it('generates a req_-prefixed UUID', () => {
    const id = newRequestId();
    expect(id.startsWith('req_')).toBe(true);
    expect(id.length).toBeGreaterThan('req_'.length);
    expect(isRequestId(id)).toBe(true);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newRequestId()));
    expect(ids.size).toBe(100);
  });
});

describe('isRequestId', () => {
  it('rejects non-prefixed values', () => {
    expect(isRequestId('abc')).toBe(false);
    expect(isRequestId('req_')).toBe(false);
  });
});
