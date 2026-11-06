import { createHash } from 'node:crypto';

/**
 * Workflow 契约（26 SPEC §7）。
 * 首期仅允许有限节点类型；禁止任意代码节点。
 */

/** workflow.v1 契约 ID。 */
export const WORKFLOW_SCHEMA_ID = 'workflow.v1';

/** 首期允许的节点类型（§7）。 */
export type WorkflowNodeType =
  | 'input'
  | 'read-file'
  | 'write-artifact'
  | 'command'
  | 'model'
  | 'transform'
  | 'condition'
  | 'approval'
  | 'subworkflow'
  | 'output';

/** 失败策略。 */
export type WorkflowFailurePolicy = 'abort' | 'continue';

/** 重试策略。 */
export interface WorkflowRetry {
  maxAttempts: number;
}

/** 单个工作流节点（§7：必须声明输入/输出 Schema、超时、重试、幂等键和失败策略）。 */
export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  timeoutSeconds?: number;
  retry?: WorkflowRetry;
  idempotencyKey?: string;
  onFailure?: WorkflowFailurePolicy;
  /** 类型特有配置（command/model/transform 等）。 */
  config?: Record<string, unknown>;
  /** 后继节点 ID（声明式 DAG 边）。 */
  next?: string[];
}

/** workflow.v1 定义。 */
export interface WorkflowDefinition {
  schemaVersion: 'workflow.v1';
  id: string;
  name: string;
  /** SemVer。 */
  version: string;
  nodes: WorkflowNode[];
}

/** 内容 SHA-256（§7：WorkflowDefinition 必须有稳定 ID、SemVer、内容 SHA-256）。 */
export function computeWorkflowHash(definition: WorkflowDefinition): string {
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}

/** Workflow 校验问题。 */
export interface WorkflowValidationIssue {
  nodeId?: string;
  message: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
}

/** 受限节点校验（§7：禁止任意代码节点；节点必须声明受控配置）。 */
export function validateRestrictedNode(node: WorkflowNode): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  const config = node.config ?? {};
  // 禁止任意代码字段（命令注入 / 任意脚本）
  for (const forbidden of ['executable', 'arguments', 'code', 'script', 'shell', 'command']) {
    if (forbidden in config) {
      issues.push({ nodeId: node.id, message: `节点 ${node.type} 禁止声明 ${forbidden}` });
    }
  }
  switch (node.type) {
    case 'command':
      if (typeof config.commandId !== 'string' || config.commandId.length === 0) {
        issues.push({ nodeId: node.id, message: 'command 节点必须声明 commandId' });
      }
      break;
    case 'model':
      if (typeof config.modelProfileId !== 'string' || config.modelProfileId.length === 0) {
        issues.push({ nodeId: node.id, message: 'model 节点必须声明 modelProfileId' });
      }
      if (typeof config.prompt !== 'string' || config.prompt.length === 0) {
        issues.push({ nodeId: node.id, message: 'model 节点必须声明 prompt' });
      }
      break;
    case 'transform':
      if (typeof config.template !== 'string' || config.template.length === 0) {
        issues.push({ nodeId: node.id, message: 'transform 节点必须声明 template' });
      }
      break;
    case 'read-file':
    case 'write-artifact':
      if (typeof config.path !== 'string' || config.path.length === 0) {
        issues.push({ nodeId: node.id, message: `${node.type} 节点必须声明 path` });
      }
      break;
    default:
      break;
  }
  return { valid: issues.length === 0, issues };
}

/** DAG 校验（§7 声明式 DAG）：节点 ID 唯一 + 边指向存在节点 + 无环。 */
export function validateWorkflowDAG(definition: WorkflowDefinition): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  const ids = new Set<string>();
  for (const node of definition.nodes) {
    if (ids.has(node.id)) {
      issues.push({ nodeId: node.id, message: `节点 ID 重复: ${node.id}` });
    }
    ids.add(node.id);
  }
  for (const node of definition.nodes) {
    for (const next of node.next ?? []) {
      if (!ids.has(next)) {
        issues.push({ nodeId: node.id, message: `边指向不存在的节点: ${next}` });
      }
    }
  }
  // Kahn 拓扑排序检测环
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of definition.nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const node of definition.nodes) {
    for (const next of node.next ?? []) {
      adjacency.get(node.id)?.push(next);
      indegree.set(next, (indegree.get(next) ?? 0) + 1);
    }
  }
  const queue = [...definition.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)];
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift() as string;
    visited++;
    for (const next of adjacency.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) {
        queue.push(next);
      }
    }
  }
  if (visited !== definition.nodes.length) {
    issues.push({ message: 'Workflow 存在环（非 DAG）' });
  }
  return { valid: issues.length === 0, issues };
}

/** 拓扑排序（要求无环，返回节点 ID 顺序）。 */
export function topologicalSort(definition: WorkflowDefinition): string[] {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of definition.nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const node of definition.nodes) {
    for (const next of node.next ?? []) {
      adjacency.get(node.id)?.push(next);
      indegree.set(next, (indegree.get(next) ?? 0) + 1);
    }
  }
  const queue = [...definition.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)];
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) {
        queue.push(next);
      }
    }
  }
  return order;
}
