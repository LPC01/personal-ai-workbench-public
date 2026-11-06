import type { HarnessProfile } from '@workbench/contracts';
import { DeepSeekHarnessAdapter } from './deepseek-harness-adapter.js';
import type { HarnessAdapter, HarnessRunResponse, HarnessToolCall } from './harness-adapter.js';
import { MockHarnessAdapter } from './mock-harness-adapter.js';

/**
 * 根据 Harness Profile 创建 Adapter（26 SPEC §13 + 设计 §6.9）。
 * DeepSeek Harness 是 Execution Gateway 后的可替换 Agent 内核。
 * `mock` 对应契约已声明的 HarnessAdapterType，供联调/回归使用（无外部依赖）。
 */
export function createHarnessAdapter(profile: HarnessProfile): HarnessAdapter {
  switch (profile.adapterType) {
    case 'deepseek':
      return new DeepSeekHarnessAdapter(profile.config);
    case 'mock':
      return new MockHarnessAdapter(parseMockScript(profile.config));
    default:
      throw new Error(`不支持的 Harness Adapter 类型: ${profile.adapterType}`);
  }
}

/**
 * 从 `profile.config.script` 解析可编程 Mock 脚本（供联调 / 真实 HTTP 工具回环回归）。
 *
 * 形如 `{ script: [{ content, toolCalls, stopReason }] }`。缺省或非法项一律降级为
 * 空脚本——即 `MockHarnessAdapter` 的原始行为（无内容、无工具、立即结束），
 * 因此未显式配置 script 的既有 profile 行为不变。
 */
function parseMockScript(config: Record<string, unknown>): HarnessRunResponse[] {
  const raw = config.script;
  if (!Array.isArray(raw)) return [];
  const script: HarnessRunResponse[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { content, toolCalls, stopReason } = item as {
      content?: unknown;
      toolCalls?: unknown;
      stopReason?: unknown;
    };
    script.push({
      content: typeof content === 'string' ? content : '',
      toolCalls: Array.isArray(toolCalls) ? (toolCalls as HarnessToolCall[]) : [],
      stopReason: isStopReason(stopReason) ? stopReason : 'end',
    });
  }
  return script;
}

const STOP_REASONS = ['end', 'tool', 'max_tokens', 'cancelled', 'timeout', 'error'] as const;

function isStopReason(value: unknown): value is HarnessRunResponse['stopReason'] {
  return typeof value === 'string' && (STOP_REASONS as readonly string[]).includes(value);
}
