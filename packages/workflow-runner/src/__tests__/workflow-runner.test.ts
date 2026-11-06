import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@workbench/contracts';
import { validateRestrictedNode, validateWorkflowDAG } from '@workbench/contracts';
import { WorkflowRunner } from '../workflow-runner.js';

function flow(nodes: WorkflowDefinition['nodes']): WorkflowDefinition {
  return {
    schemaVersion: 'workflow.v1',
    id: 'meeting-flow',
    name: '会议纪要流程',
    version: '0.1.0',
    nodes,
  };
}

describe('受限节点校验（§7 禁止任意代码）', () => {
  it('command 节点必须声明 commandId，禁止任意 executable', () => {
    const bad = validateRestrictedNode({
      id: 'c1',
      type: 'command',
      config: { executable: 'sh', arguments: ['-c', 'rm -rf'] },
    });
    expect(bad.valid).toBe(false);
    expect(bad.issues.some((i) => i.message.includes('commandId'))).toBe(true);
    expect(bad.issues.some((i) => i.message.includes('executable'))).toBe(true);

    const good = validateRestrictedNode({
      id: 'c2',
      type: 'command',
      config: { commandId: 'build' },
    });
    expect(good.valid).toBe(true);
  });

  it('transform 节点必须声明 template，禁止 code', () => {
    const bad = validateRestrictedNode({ id: 't1', type: 'transform', config: { code: 'x' } });
    expect(bad.valid).toBe(false);
    const good = validateRestrictedNode({
      id: 't2',
      type: 'transform',
      config: { template: '{{title}}' },
    });
    expect(good.valid).toBe(true);
  });
});

describe('DAG 校验（§7 声明式 DAG）', () => {
  it('无环 DAG 通过', () => {
    const def = flow([
      { id: 'a', type: 'input', next: ['b'] },
      { id: 'b', type: 'output' },
    ]);
    expect(validateWorkflowDAG(def).valid).toBe(true);
  });

  it('检测环', () => {
    const def = flow([
      { id: 'a', type: 'input', next: ['b'] },
      { id: 'b', type: 'transform', next: ['a'] },
    ]);
    expect(validateWorkflowDAG(def).valid).toBe(false);
  });

  it('检测边指向不存在的节点', () => {
    const def = flow([{ id: 'a', type: 'input', next: ['nope'] }]);
    expect(validateWorkflowDAG(def).valid).toBe(false);
  });
});

describe('WorkflowRunner 确定性执行', () => {
  it('input→transform→output 全链路', async () => {
    const def = flow([
      { id: 'in', type: 'input', next: ['t'] },
      { id: 't', type: 'transform', config: { template: '# {{title}}' }, next: ['out'] },
      { id: 'out', type: 'output', config: { select: 't' } },
    ]);
    const result = await new WorkflowRunner().run(def, { title: '会议纪要' });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.output).toBe('# 会议纪要');
    expect(result.nodeResults.map((r) => r.nodeId)).toEqual(['in', 't', 'out']);
  });

  it('未实现节点类型 → FAILED', async () => {
    const def = flow([
      { id: 'in', type: 'input', next: ['m'] },
      { id: 'm', type: 'model', config: { modelProfileId: 'mp', prompt: 'x' }, next: ['out'] },
      { id: 'out', type: 'output' },
    ]);
    const result = await new WorkflowRunner().run(def, {});
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('尚未实现');
  });

  it('condition 节点确定性求值', async () => {
    const def = flow([
      { id: 'in', type: 'input', next: ['c'] },
      { id: 'c', type: 'condition', config: { expression: "{{mode}} == 'auto'" }, next: ['out'] },
      { id: 'out', type: 'output', config: { select: 'c' } },
    ]);
    const result = await new WorkflowRunner().run(def, { mode: 'auto' });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.output).toBe(true);
  });
});
