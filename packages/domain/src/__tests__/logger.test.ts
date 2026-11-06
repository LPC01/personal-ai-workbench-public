import { describe, expect, it } from 'vitest';
import { createLogger } from '../logger.js';

function capture(level: 'debug' | 'info' | 'warn' | 'error' = 'debug') {
  const lines: string[] = [];
  const logger = createLogger({ sink: (line) => lines.push(line), level });
  return { lines, logger };
}

describe('createLogger', () => {
  it('emits structured JSON lines', () => {
    const { lines, logger } = capture();
    logger.info('hello', { requestId: 'req_1' });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('hello');
    expect(entry.requestId).toBe('req_1');
    expect(typeof entry.timestamp).toBe('string');
    expect(new Date(entry.timestamp as string).toISOString()).toBe(entry.timestamp);
  });

  it('filters levels below the configured minimum', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (l) => lines.push(l), level: 'info' });
    logger.debug('hidden');
    logger.info('shown');
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0]!) as { message: string }).message).toBe('shown');
  });

  it('child() carries fixed correlation fields', () => {
    const { lines, logger } = capture();
    const child = logger.child({ requestId: 'req_2', projectId: 'p1' });
    child.error('boom', { extra: 1 });
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry.requestId).toBe('req_2');
    expect(entry.projectId).toBe('p1');
    expect(entry.extra).toBe(1);
    expect(entry.level).toBe('error');
  });
});
