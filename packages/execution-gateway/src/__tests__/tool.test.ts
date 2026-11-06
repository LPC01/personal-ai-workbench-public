import { describe, expect, it } from 'vitest';
import { AppError } from '@workbench/domain';
import { HarnessToolRegistry, type HarnessTool } from '../tool.js';

const describeTool: HarnessTool = {
  toolId: 'project.describe',
  async execute(args) {
    return { id: args.projectId, name: '示例' };
  },
};

function registry(): HarnessToolRegistry {
  const r = new HarnessToolRegistry();
  r.register(describeTool);
  return r;
}

describe('HarnessToolRegistry', () => {
  it('执行白名单内的工具并返回稳定 ID', async () => {
    const r = registry();
    const result = await r.execute(
      { id: 'call-1', toolId: 'project.describe', arguments: { projectId: 'p1' } },
      { allowedToolIds: ['project.describe'], constraints: {} },
    );
    expect(result.ok).toBe(true);
    expect(result.toolCallId).toBe('call-1');
    expect(result.data).toEqual({ id: 'p1', name: '示例' });
  });

  it('策略未允许的工具被拒绝（EXTENSION_PERMISSION_DENIED）', async () => {
    const r = registry();
    const result = await r.execute(
      { id: 'call-2', toolId: 'project.describe', arguments: {} },
      { allowedToolIds: ['run.status'], constraints: {} },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('EXTENSION_PERMISSION_DENIED');
  });

  it('非法工具 ID 被拒绝', async () => {
    const r = registry();
    const result = await r.execute(
      { id: 'call-3', toolId: 'shell.exec', arguments: {} },
      { allowedToolIds: ['project.describe'], constraints: {} },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('EXTENSION_PERMISSION_DENIED');
  });

  it('未实现的工具返回 TOOL_NOT_IMPLEMENTED', async () => {
    const r = registry();
    const result = await r.execute(
      { id: 'call-4', toolId: 'artifact.read', arguments: {} },
      { allowedToolIds: ['artifact.read'], constraints: {} },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('TOOL_NOT_IMPLEMENTED');
  });

  it('工具抛 AppError 时透传错误码', async () => {
    const r = new HarnessToolRegistry();
    r.register({
      toolId: 'run.status',
      async execute() {
        throw new AppError('RUN_NOT_FOUND', 'Run 不存在');
      },
    });
    const result = await r.execute(
      { id: 'call-5', toolId: 'run.status', arguments: { runId: 'nope' } },
      { allowedToolIds: ['run.status'], constraints: {} },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('RUN_NOT_FOUND');
  });
});
