import { describe, expect, it } from 'vitest';
import { spawnProcess } from '../process-executor.js';

function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let data = '';
  stream.on('data', (chunk: Buffer) => {
    data += chunk.toString();
  });
  return new Promise((resolve) => {
    stream.on('end', () => resolve(data));
  });
}

const NODE = process.execPath;

describe('spawnProcess', () => {
  it('spawns a process and captures stdout + exit code', async () => {
    const proc = spawnProcess({
      executable: NODE,
      arguments: ['-e', "console.log('hello-from-child')"],
    });
    expect(proc.pid).toBeGreaterThan(0);
    const out = await readAll(proc.stdout);
    const code = await proc.exited;
    expect(out).toContain('hello-from-child');
    expect(code).toBe(0);
  });

  it('captures stderr separately', async () => {
    const proc = spawnProcess({
      executable: NODE,
      arguments: ['-e', "console.error('err-line')"],
    });
    const err = await readAll(proc.stderr);
    await proc.exited;
    expect(err).toContain('err-line');
  });

  it('stops a long-running process via stop()', async () => {
    const proc = spawnProcess({
      executable: NODE,
      arguments: ['-e', 'setInterval(() => {}, 1000)'],
    });
    proc.stop();
    const code = await proc.exited;
    // 被终止的进程退出码通常非 0（或 null）
    expect(code === null || code !== 0).toBe(true);
  });

  it('terminates a process exceeding timeoutMs and flags timedOut', async () => {
    const proc = spawnProcess({
      executable: NODE,
      arguments: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 300,
    });
    const code = await proc.exited;
    expect(proc.timedOut).toBe(true);
    expect(code === null || code !== 0).toBe(true);
  });

  it('does not terminate when timeoutMs is omitted or non-positive', async () => {
    const proc = spawnProcess({
      executable: NODE,
      arguments: ['-e', "setTimeout(() => console.log('finished'), 300)"],
      timeoutMs: 0,
    });
    const out = await readAll(proc.stdout);
    const code = await proc.exited;
    expect(proc.timedOut).toBe(false);
    expect(out).toContain('finished');
    expect(code).toBe(0);
  });

  it('manual stop() clears the timeout so timedOut stays false', async () => {
    const proc = spawnProcess({
      executable: NODE,
      arguments: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 5000,
    });
    proc.stop();
    await proc.exited;
    expect(proc.timedOut).toBe(false);
  });
});
