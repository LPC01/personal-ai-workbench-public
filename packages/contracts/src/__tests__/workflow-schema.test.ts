import { describe, expect, it } from 'vitest';
import { computeWorkflowHash, type WorkflowDefinition } from '../workflow.js';
import { createWorkflowValidator } from '../workflow-schema.js';

function validDefinition(): WorkflowDefinition {
  return {
    schemaVersion: 'workflow.v1',
    id: 'meeting-flow',
    name: '会议纪要流程',
    version: '0.1.0',
    nodes: [
      { id: 'in', type: 'input', inputSchema: { type: 'object', properties: {} } },
      { id: 'out', type: 'output', next: [] },
    ],
  };
}

describe('workflow schema（workflow.v1）', () => {
  it('校验合法定义', () => {
    const validate = createWorkflowValidator();
    expect(validate(validDefinition()).valid).toBe(true);
  });

  it('拒绝非法节点类型（任意代码节点）', () => {
    const validate = createWorkflowValidator();
    const def = validDefinition();
    def.nodes[0] = { id: 'x', type: 'code' as never };
    expect(validate(def).valid).toBe(false);
  });

  it('拒绝非法版本号', () => {
    const validate = createWorkflowValidator();
    const def = validDefinition();
    def.version = '1.0';
    expect(validate(def).valid).toBe(false);
  });

  it('拒绝空节点列表', () => {
    const validate = createWorkflowValidator();
    const def = validDefinition();
    def.nodes = [];
    expect(validate(def).valid).toBe(false);
  });

  it('内容哈希稳定且随内容变化', () => {
    const a = validDefinition();
    const b = validDefinition();
    expect(computeWorkflowHash(a)).toBe(computeWorkflowHash(b));
    b.nodes = [
      { id: 'in2', type: 'input' },
      { id: 'out', type: 'output' },
    ];
    expect(computeWorkflowHash(a)).not.toBe(computeWorkflowHash(b));
  });
});
