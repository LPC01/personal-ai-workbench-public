import { describe, expect, it } from 'vitest';
import { WorkerRunner } from '../worker-runner.js';

describe('WorkerRunner（独立进程运行）', () => {
  it('成功脚本返回 SUCCEEDED + stdout', async () => {
    const result = await new WorkerRunner().run({ script: "console.log('worker-ok')" });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.stdout).toContain('worker-ok');
    expect(result.exitCode).toBe(0);
  });

  it('失败脚本（非零退出码）返回 FAILED + stderr', async () => {
    const result = await new WorkerRunner().run({
      script: "console.error('boom'); process.exit(3)",
    });
    expect(result.status).toBe('FAILED');
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('boom');
  });

  it('超时脚本返回 TIMEOUT', async () => {
    const result = await new WorkerRunner().run({
      script: 'setInterval(() => {}, 1000)',
      timeoutSeconds: 1,
    });
    expect(result.status).toBe('TIMEOUT');
  });

  it('输出限长截断', async () => {
    const result = await new WorkerRunner().run({
      script: "console.log('x'.repeat(1000))",
      maxOutputBytes: 100,
    });
    expect(result.stdout.length).toBeLessThan(200);
    expect(result.stdout).toContain('[truncated]');
  });
});
