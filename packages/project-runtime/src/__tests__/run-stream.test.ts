import { describe, expect, it } from 'vitest';
import { RunStreamHub, toSseFrame, type RunStreamEvent } from '../run-stream.js';

const ev = (sequence: number, eventType = 'state'): RunStreamEvent => ({
  sequence,
  eventType,
  payload: { n: sequence },
  createdAt: '2026-09-28T00:00:00.000Z',
});

describe('RunStreamHub', () => {
  it('delivers published events to subscribers', () => {
    const hub = new RunStreamHub();
    const received: number[] = [];
    hub.subscribe('run-1', (e) => received.push(e.sequence));
    hub.publish('run-1', ev(1));
    hub.publish('run-1', ev(2));
    expect(received).toEqual([1, 2]);
  });

  it('isolates subscribers by run id', () => {
    const hub = new RunStreamHub();
    const a: number[] = [];
    const b: number[] = [];
    hub.subscribe('run-a', (e) => a.push(e.sequence));
    hub.subscribe('run-b', (e) => b.push(e.sequence));
    hub.publish('run-a', ev(1));
    expect(a).toEqual([1]);
    expect(b).toEqual([]);
  });

  it('unsubscribe stops delivery', () => {
    const hub = new RunStreamHub();
    const received: number[] = [];
    const off = hub.subscribe('run-1', (e) => received.push(e.sequence));
    hub.publish('run-1', ev(1));
    off();
    hub.publish('run-1', ev(2));
    expect(received).toEqual([1]);
  });
});

describe('toSseFrame', () => {
  it('formats an SSE frame with id/event/data', () => {
    const frame = toSseFrame(ev(3, 'log'));
    expect(frame).toContain('id: 3\n');
    expect(frame).toContain('event: log\n');
    expect(frame).toContain('data: {"sequence":3,"eventType":"log"');
    expect(frame.endsWith('\n\n')).toBe(true);
  });
});
