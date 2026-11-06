import type { HarnessToolId, ToolPolicy } from '@workbench/contracts';
import { isHarnessTool } from '@workbench/contracts';
import { AppError } from '@workbench/domain';
import { redactSecrets } from './redaction.js';

/**
 * Harness 工具执行契约（26 SPEC §13）。
 *
 * Harness 只能调用当前 Run 允许的工具（白名单由 ToolPolicy 约束）。工具返回值必须带
 * 稳定 ID（toolCallId），不返回主机绝对路径。
 */

/** Harness 发起的工具调用（toolId 为原始字符串，运行时白名单校验）。 */
export interface HarnessToolInvocation {
  id: string;
  toolId: string;
  arguments: Record<string, unknown>;
}

/** 工具执行结果：带稳定 ID，不包含主机绝对路径。 */
export interface HarnessToolResult {
  toolCallId: string;
  /** 回显请求的 toolId（含非法值，便于诊断）。 */
  toolId: string;
  ok: boolean;
  data: unknown;
  errorCode?: string;
}

/** 工具作用域：当前 Run 绑定的项目/运行，工具据此约束可触达的资源。 */
export interface HarnessToolScope {
  projectId: string | null;
  runId: string | null;
}

/** 单个 Harness 工具。 */
export interface HarnessTool {
  readonly toolId: HarnessToolId;
  execute(
    args: Record<string, unknown>,
    policy: ToolPolicy,
    scope?: HarnessToolScope,
  ): Promise<unknown>;
}

/** 工具注册表：白名单校验 + 分发（26 SPEC §13）。 */
export class HarnessToolRegistry {
  private readonly tools = new Map<HarnessToolId, HarnessTool>();

  register(tool: HarnessTool): void {
    this.tools.set(tool.toolId, tool);
  }

  listToolIds(): HarnessToolId[] {
    return [...this.tools.keys()];
  }

  async execute(
    call: HarnessToolInvocation,
    policy: ToolPolicy,
    scope?: HarnessToolScope,
  ): Promise<HarnessToolResult> {
    // 非法工具 ID 直接拒绝
    if (!isHarnessTool(call.toolId)) {
      return {
        toolCallId: call.id,
        toolId: call.toolId,
        ok: false,
        data: null,
        errorCode: 'EXTENSION_PERMISSION_DENIED',
      };
    }
    const toolId = call.toolId;
    // 工具策略白名单校验
    if (!policy.allowedToolIds.includes(toolId)) {
      return {
        toolCallId: call.id,
        toolId,
        ok: false,
        data: null,
        errorCode: 'EXTENSION_PERMISSION_DENIED',
      };
    }
    const tool = this.tools.get(toolId);
    if (!tool) {
      return {
        toolCallId: call.id,
        toolId,
        ok: false,
        data: null,
        errorCode: 'TOOL_NOT_IMPLEMENTED',
      };
    }
    try {
      const data = await tool.execute(call.arguments, policy, scope);
      return { toolCallId: call.id, toolId, ok: true, data: redactSecrets(data) };
    } catch (error) {
      const errorCode = error instanceof AppError ? error.code : 'TOOL_ERROR';
      return { toolCallId: call.id, toolId, ok: false, data: null, errorCode };
    }
  }
}
