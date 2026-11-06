import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@workbench/contracts';
import {
  DeterministicExecutor,
  WorkflowRunner,
  type NodeExecution,
  type WorkflowNodeExecutor,
  type WorkflowNodeResult,
} from '../workflow-runner.js';

function flow(nodes: WorkflowDefinition['nodes']): WorkflowDefinition {
  return {
    schemaVersion: 'workflow.v1',
    id: 'meeting-flow',
    name: '会议纪要流程',
    version: '0.1.0',
    nodes,
  };
}

describe('P6-03 幂等/重试/失败策略/审批/恢复', () => {
  it('重试：失败节点按 retry.maxAttempts 重试后成功', async () => {
    let calls = 0;
    const base = new DeterministicExecutor();
    const flaky: WorkflowNodeExecutor = {
      async execute(node, input, outputs): Promise<NodeExecution> {
        if (node.type === 'transform') {
          calls++;
          return calls < 3 ? { output: null, error: 'flaky' } : { output: 'ok' };
        }
        return base.execute(node, input, outputs);
      },
    };
    const def = flow([
      { id: 'in', type: 'input', next: ['t'] },
      {
        id: 't',
        type: 'transform',
        config: { template: 'x' },
        retry: { maxAttempts: 2 },
        next: ['out'],
      },
      { id: 'out', type: 'output', config: { select: 't' } },
    ]);
    const result = await new WorkflowRunner(flaky).run(def, {});
    expect(result.status).toBe('SUCCEEDED');
    const t = result.nodeResults.find((r) => r.nodeId === 't') as WorkflowNodeResult;
    expect(t.attempts).toBe(3);
  });

  it('失败策略 onFailure=continue 继续执行后续节点', async () => {
    const base = new DeterministicExecutor();
    const failing: WorkflowNodeExecutor = {
      async execute(node, input, outputs): Promise<NodeExecution> {
        if (node.type === 'transform') {
          return { output: null, error: 'boom' };
        }
        return base.execute(node, input, outputs);
      },
    };
    const def = flow([
      { id: 'in', type: 'input', next: ['t', 'out'] },
      { id: 't', type: 'transform', config: { template: 'x' }, onFailure: 'continue' },
      { id: 'out', type: 'output', config: { select: 'in' } },
    ]);
    const result = await new WorkflowRunner(failing).run(def, { title: 'a' });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.nodeResults.find((r) => r.nodeId === 't')?.status).toBe('FAILED');
  });

  it('失败策略默认 abort 中止', async () => {
    const base = new DeterministicExecutor();
    const failing: WorkflowNodeExecutor = {
      async execute(node, input, outputs): Promise<NodeExecution> {
        if (node.type === 'transform') {
          return { output: null, error: 'boom' };
        }
        return base.execute(node, input, outputs);
      },
    };
    const def = flow([
      { id: 'in', type: 'input', next: ['t'] },
      { id: 't', type: 'transform', config: { template: 'x' }, next: ['out'] },
      { id: 'out', type: 'output' },
    ]);
    const result = await new WorkflowRunner(failing).run(def, {});
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('boom');
  });

  it('approval 节点挂起 → WAITING_USER + pendingApproval', async () => {
    const def = flow([
      { id: 'in', type: 'input', next: ['app'] },
      { id: 'app', type: 'approval', config: { targetRef: 'local-to-cloud' }, next: ['out'] },
      { id: 'out', type: 'output' },
    ]);
    const result = await new WorkflowRunner().run(def, {});
    expect(result.status).toBe('WAITING_USER');
    expect(result.pendingApproval?.targetRef).toBe('local-to-cloud');
  });

  it('幂等恢复：已提交步骤 SKIPPED', async () => {
    const def = flow([
      { id: 'in', type: 'input', next: ['t'] },
      { id: 't', type: 'transform', config: { template: '{{title}}' }, next: ['out'] },
      { id: 'out', type: 'output', config: { select: 't' } },
    ]);
    const first = await new WorkflowRunner().run(def, { title: 'a' });
    expect(first.status).toBe('SUCCEEDED');

    const resume: WorkflowNodeResult[] = [
      { nodeId: 'in', type: 'input', status: 'SUCCEEDED', output: { title: 'a' }, attempts: 1 },
    ];
    const resumed = await new WorkflowRunner().run(def, { title: 'a' }, { resume });
    expect(resumed.status).toBe('SUCCEEDED');
    expect(resumed.nodeResults.find((r) => r.nodeId === 'in')?.status).toBe('SKIPPED');
  });
});
