import type {
  HarnessAdapter,
  HarnessEvent,
  HarnessHealth,
  HarnessRunRequest,
  HarnessRunResponse,
} from './harness-adapter.js';

/**
 * 可编程 Mock Harness Adapter（26 SPEC §13 + P4-07 降级）。
 *
 * 按给定脚本依次返回回合结果；用于单测（工具回环）与 Harness 不可用降级验证。
 */
export class MockHarnessAdapter implements HarnessAdapter {
  private index = 0;
  private cancelled = false;
  private lastRequest: HarnessRunRequest | undefined;

  constructor(private readonly script: HarnessRunResponse[] = []) {}

  get last(): HarnessRunRequest | undefined {
    return this.lastRequest;
  }

  async health(): Promise<HarnessHealth> {
    return { ok: true };
  }

  async run(request: HarnessRunRequest): Promise<HarnessRunResponse> {
    this.lastRequest = request;
    if (this.cancelled) {
      return { content: '', toolCalls: [], stopReason: 'cancelled' };
    }
    const response = this.script[this.index] ?? { content: '', toolCalls: [], stopReason: 'end' };
    this.index = Math.min(this.index + 1, this.script.length);
    return response;
  }

  async *stream(request: HarnessRunRequest): AsyncIterable<HarnessEvent> {
    const response = await this.run(request);
    yield {
      sequence: 1,
      type: 'message',
      payload: { content: response.content },
      createdAt: new Date().toISOString(),
    };
    for (const toolCall of response.toolCalls) {
      yield {
        sequence: 2,
        type: 'tool_call',
        payload: { toolCall },
        createdAt: new Date().toISOString(),
      };
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
  }
}
