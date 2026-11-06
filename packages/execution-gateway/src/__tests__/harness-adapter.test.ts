import { describe, expect, it } from 'vitest';
import type {
  HarnessAdapter,
  HarnessEvent,
  HarnessRunRequest,
  HarnessRunResponse,
} from '../harness-adapter.js';

/**
 * Mock Harness Adapter：证明 HarnessAdapter 契约可实现、事件可归一化。
 * 用于 P4-07 的 Harness 不可用降级与后续单测桩。
 */
class MockHarnessAdapter implements HarnessAdapter {
  private cancelled = new Set<string>();

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }

  async run(request: HarnessRunRequest): Promise<HarnessRunResponse> {
    if (this.cancelled.has(request.sessionId)) {
      return { content: '', toolCalls: [], stopReason: 'cancelled' };
    }
    return {
      content: `echo:${request.prompt}`,
      toolCalls: [],
      stopReason: 'end',
      usage: { promptTokens: 1, completionTokens: 1 },
    };
  }

  async *stream(request: HarnessRunRequest): AsyncIterable<HarnessEvent> {
    yield {
      sequence: 1,
      type: 'state',
      payload: { status: 'running', sessionId: request.sessionId },
      createdAt: new Date().toISOString(),
    };
    yield {
      sequence: 2,
      type: 'message',
      payload: { content: 'hi' },
      createdAt: new Date().toISOString(),
    };
  }

  async cancel(sessionId: string): Promise<void> {
    this.cancelled.add(sessionId);
  }
}

describe('HarnessAdapter 契约', () => {
  it('Mock 实现满足契约，run 返回归一化结果', async () => {
    const adapter = new MockHarnessAdapter();
    expect((await adapter.health()).ok).toBe(true);

    const res = await adapter.run({
      sessionId: 'sess-1',
      modelProfileId: 'deepseek-code',
      prompt: '整理纪要',
      messages: [],
      tools: ['project.describe'],
      toolPolicy: { allowedToolIds: ['project.describe'], constraints: {} },
    });
    expect(res.content).toBe('echo:整理纪要');
    expect(res.stopReason).toBe('end');
  });

  it('stream 产生归一化事件序列', async () => {
    const adapter = new MockHarnessAdapter();
    const events: HarnessEvent[] = [];
    for await (const event of adapter.stream({
      sessionId: 'sess-2',
      modelProfileId: 'deepseek-code',
      prompt: 'x',
      messages: [],
      tools: [],
      toolPolicy: { allowedToolIds: [], constraints: {} },
    })) {
      events.push(event);
    }
    expect(events.map((e) => e.sequence)).toEqual([1, 2]);
    expect(events.map((e) => e.type)).toEqual(['state', 'message']);
  });

  it('cancel 后 run 返回 cancelled', async () => {
    const adapter = new MockHarnessAdapter();
    await adapter.cancel('sess-3');
    const res = await adapter.run({
      sessionId: 'sess-3',
      modelProfileId: 'deepseek-code',
      prompt: 'x',
      messages: [],
      tools: [],
      toolPolicy: { allowedToolIds: [], constraints: {} },
    });
    expect(res.stopReason).toBe('cancelled');
  });
});
