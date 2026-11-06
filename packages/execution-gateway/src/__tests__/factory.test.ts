import { describe, expect, it } from 'vitest';
import type { HarnessProfile } from '@workbench/contracts';
import type { HarnessRunRequest } from '../harness-adapter.js';
import { createHarnessAdapter } from '../factory.js';

function profile(
  adapterType: HarnessProfile['adapterType'],
  config: Record<string, unknown> = {},
): HarnessProfile {
  return {
    id: `p-${adapterType}`,
    name: adapterType,
    adapterType,
    config,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const request: HarnessRunRequest = {
  sessionId: 's1',
  modelProfileId: 'm1',
  prompt: 'hi',
  messages: [],
  tools: [],
  toolPolicy: { allowedToolIds: [], constraints: {} },
};

describe('createHarnessAdapter（mock 脚本解析）', () => {
  it('未配置 script 时保持原行为（空内容、无工具、立即结束）', async () => {
    const adapter = createHarnessAdapter(profile('mock'));
    const response = await adapter.run(request);
    expect(response.content).toBe('');
    expect(response.toolCalls).toEqual([]);
    expect(response.stopReason).toBe('end');
  });

  it('按 config.script 依次返回回合结果（含工具调用）', async () => {
    const adapter = createHarnessAdapter(
      profile('mock', {
        script: [
          {
            content: '先查询项目',
            toolCalls: [{ id: 't1', toolId: 'project.describe', arguments: { projectId: 'demo' } }],
            stopReason: 'tool',
          },
          { content: '完成', toolCalls: [], stopReason: 'end' },
        ],
      }),
    );

    const first = await adapter.run(request);
    expect(first.content).toBe('先查询项目');
    expect(first.toolCalls).toHaveLength(1);
    expect(first.toolCalls[0]?.toolId).toBe('project.describe');
    expect(first.stopReason).toBe('tool');

    const second = await adapter.run(request);
    expect(second.content).toBe('完成');
    expect(second.stopReason).toBe('end');
  });

  it('非法/缺失字段降级（content 非字符串→空、stopReason 非法→end、非数组 script→空）', async () => {
    const adapter = createHarnessAdapter(
      profile('mock', {
        script: [{ content: 123, toolCalls: 'nope', stopReason: 'bogus' }, 'not-an-object'],
      }),
    );
    const response = await adapter.run(request);
    expect(response.content).toBe('');
    expect(response.toolCalls).toEqual([]);
    expect(response.stopReason).toBe('end');

    const empty = createHarnessAdapter(profile('mock', { script: 'not-an-array' }));
    expect((await empty.run(request)).content).toBe('');
  });

  it('未实现的 adapter 类型抛错', () => {
    expect(() => createHarnessAdapter(profile('openai-agents'))).toThrow(
      /不支持的 Harness Adapter/,
    );
  });
});
