import {
  topologicalSort,
  validateRestrictedNode,
  validateWorkflowDAG,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@workbench/contracts';

export interface WorkflowNodeResult {
  nodeId: string;
  type: string;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  output: unknown;
  attempts: number;
  error?: string;
}

export interface WorkflowRunResult {
  status: 'SUCCEEDED' | 'FAILED' | 'WAITING_USER';
  output: unknown;
  nodeResults: WorkflowNodeResult[];
  pendingApproval?: { nodeId: string; targetRef: string };
  error?: string;
}

export interface NodeExecution {
  output: unknown;
  error?: string;
  /** approval 节点：请求挂起审批。 */
  pendingApproval?: { targetRef: string };
}

/** 节点执行器（可注入，用于测试重试/失败；默认确定性执行器）。 */
export interface WorkflowNodeExecutor {
  execute(
    node: WorkflowNode,
    input: Record<string, unknown>,
    outputs: Map<string, unknown>,
  ): Promise<NodeExecution>;
}

/** 恢复执行选项：传入已提交步骤，幂等跳过。 */
export interface RunOptions {
  resume?: WorkflowNodeResult[];
}

/** 从 input/outputs 按点路径取值。 */
function resolvePath(value: unknown, path: string): unknown {
  const parts = path.split('.').filter((p) => p.length > 0);
  let current: unknown = value;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/** `{{path}}` 占位符替换。 */
function renderTemplate(
  template: string,
  input: Record<string, unknown>,
  outputs: Map<string, unknown>,
): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
    if (expr.startsWith('$')) {
      const dot = expr.indexOf('.');
      const nodeId = dot >= 0 ? expr.slice(1, dot) : expr.slice(1);
      const path = dot >= 0 ? expr.slice(dot + 1) : '';
      const value = resolvePath(outputs.get(nodeId), path);
      return value === undefined ? '' : String(value);
    }
    const value = resolvePath(input, expr);
    return value === undefined ? '' : String(value);
  });
}

/** 内置确定性执行器。 */
export class DeterministicExecutor implements WorkflowNodeExecutor {
  async execute(
    node: WorkflowNode,
    input: Record<string, unknown>,
    outputs: Map<string, unknown>,
  ): Promise<NodeExecution> {
    switch (node.type) {
      case 'input':
        return { output: input };
      case 'transform':
        return { output: renderTemplate(String(node.config?.template ?? ''), input, outputs) };
      case 'condition': {
        const m = /^\{\{\s*([^}]+?)\s*\}\}\s*(==|!=)\s*(.+)$/.exec(
          String(node.config?.expression ?? ''),
        );
        if (m) {
          const expr = m[1] as string;
          const op = m[2] as string;
          const expected = (m[3] as string).trim().replace(/^['"]|['"]$/g, '');
          const value = resolvePath(input, expr);
          const s = value === undefined ? '' : String(value);
          return { output: op === '==' ? s === expected : s !== expected };
        }
        return { output: Boolean(resolvePath(input, String(node.config?.expression ?? ''))) };
      }
      case 'output': {
        const select = node.config?.select as string | undefined;
        return select ? { output: outputs.get(select) } : { output: Object.fromEntries(outputs) };
      }
      case 'approval':
        return {
          output: null,
          pendingApproval: { targetRef: String(node.config?.targetRef ?? node.id) },
        };
      default:
        return { output: null, error: `节点类型 ${node.type} 尚未实现（P6-04/P6-06）` };
    }
  }
}

/**
 * Workflow Runner（26 SPEC §7 + 设计 §6.7）。
 * 支持：受限节点 + DAG 校验、拓扑执行、步骤幂等（恢复跳过已提交）、
 * 重试（retry.maxAttempts）、失败策略（onFailure abort/continue）、approval 挂起（WAITING_USER）。
 */
export class WorkflowRunner {
  constructor(private readonly executor: WorkflowNodeExecutor = new DeterministicExecutor()) {}

  async run(
    definition: WorkflowDefinition,
    input: Record<string, unknown>,
    options: RunOptions = {},
  ): Promise<WorkflowRunResult> {
    const dag = validateWorkflowDAG(definition);
    if (!dag.valid) {
      return {
        status: 'FAILED',
        output: null,
        nodeResults: [],
        error: dag.issues.map((i) => i.message).join('; '),
      };
    }
    for (const node of definition.nodes) {
      const restricted = validateRestrictedNode(node);
      if (!restricted.valid) {
        return {
          status: 'FAILED',
          output: null,
          nodeResults: [],
          error: restricted.issues.map((i) => i.message).join('; '),
        };
      }
    }

    // 恢复：已提交步骤按节点 ID 建立索引
    const committed = new Map<string, WorkflowNodeResult>();
    for (const r of options.resume ?? []) {
      if (r.status === 'SUCCEEDED') {
        committed.set(r.nodeId, r);
      }
    }

    const nodes = new Map(definition.nodes.map((n) => [n.id, n]));
    const outputs = new Map<string, unknown>();
    const nodeResults: WorkflowNodeResult[] = [];

    for (const id of topologicalSort(definition)) {
      const node = nodes.get(id) as WorkflowNode;

      // 幂等：已提交步骤跳过
      const prior = committed.get(id);
      if (prior) {
        outputs.set(id, prior.output);
        nodeResults.push({ ...prior, status: 'SKIPPED' });
        continue;
      }

      const { execution, attempts } = await this.executeWithRetry(node, input, outputs);
      outputs.set(id, execution.output);

      if (execution.pendingApproval) {
        nodeResults.push({
          nodeId: id,
          type: node.type,
          status: 'SKIPPED',
          output: null,
          attempts,
        });
        return {
          status: 'WAITING_USER',
          output: null,
          nodeResults,
          pendingApproval: { nodeId: id, targetRef: execution.pendingApproval.targetRef },
        };
      }

      if (execution.error) {
        nodeResults.push({
          nodeId: id,
          type: node.type,
          status: 'FAILED',
          output: null,
          attempts,
          error: execution.error,
        });
        if (node.onFailure === 'continue') {
          continue;
        }
        return { status: 'FAILED', output: null, nodeResults, error: execution.error };
      }

      nodeResults.push({
        nodeId: id,
        type: node.type,
        status: 'SUCCEEDED',
        output: execution.output,
        attempts,
      });
    }

    const outputNode = definition.nodes.find((n) => n.type === 'output');
    const output = outputNode ? outputs.get(outputNode.id) : Object.fromEntries(outputs);
    return { status: 'SUCCEEDED', output, nodeResults };
  }

  private async executeWithRetry(
    node: WorkflowNode,
    input: Record<string, unknown>,
    outputs: Map<string, unknown>,
  ): Promise<{ execution: NodeExecution; attempts: number }> {
    const maxAttempts = node.retry?.maxAttempts ?? 0;
    let attempts = 0;
    let execution: NodeExecution = { output: null };
    while (attempts <= maxAttempts) {
      attempts++;
      execution = await this.executor.execute(node, input, outputs);
      if (!execution.error) {
        break;
      }
    }
    return { execution, attempts };
  }
}
