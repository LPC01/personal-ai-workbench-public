import { describe, expect, it } from 'vitest';
import {
  computeWorkflowHash,
  createExtensionValidator,
  createWorkflowValidator,
  validateIframeMessage,
  validateRestrictedNode,
  validateWorkflowDAG,
  type ExtensionSpec,
  type WorkflowDefinition,
} from '@workbench/contracts';
import { BuilderWorkspace } from '../builder-workspace.js';

function maliciousWorkflow(config: Record<string, unknown>): WorkflowDefinition {
  return {
    schemaVersion: 'workflow.v1',
    id: 'evil',
    name: '恶意工作流',
    version: '0.1.0',
    nodes: [
      { id: 'in', type: 'input', next: ['cmd'] },
      { id: 'cmd', type: 'command', config, next: ['out'] },
      { id: 'out', type: 'output' },
    ],
  };
}

function extensionSpec(overrides: Partial<ExtensionSpec> = {}): ExtensionSpec {
  return {
    schemaVersion: 'workbench.extension/v1',
    extension: { id: 'evil-ext', name: '恶意扩展', version: '0.1.0', types: ['assistant'] },
    scope: { install: 'global', run: 'project' },
    permissions: {
      files: { read: [], write: [] },
      commands: ['rm'],
      network: true,
      credentials: [],
    },
    ...overrides,
  };
}

describe('P6-09 安全测试（恶意扩展/依赖篡改/消息伪造）', () => {
  it('恶意扩展：命令注入（shell/executable）被受限节点拒绝', () => {
    const node = maliciousWorkflow({ shell: 'sh -c "rm -rf /"', commandId: 'x' }).nodes[1]!;
    const result = validateRestrictedNode(node);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('shell'))).toBe(true);
  });

  it('恶意扩展：非法 extension Schema 拒绝', () => {
    const validate = createExtensionValidator();
    const spec = extensionSpec({
      permissions: {
        files: { read: [], write: [] },
        commands: [],
        network: 'yes' as never,
        credentials: [],
      },
    });
    expect(validate(spec).valid).toBe(false);
  });

  it('恶意扩展：workflow 含环被 DAG 校验拒绝', () => {
    const def = maliciousWorkflow({ commandId: 'x' });
    def.nodes[2] = { id: 'out', type: 'output', next: ['in'] };
    expect(validateWorkflowDAG(def).valid).toBe(false);
  });

  it('恶意扩展：非法节点类型被 workflow Schema 拒绝', () => {
    const validate = createWorkflowValidator();
    const def = maliciousWorkflow({ commandId: 'x' });
    def.nodes[1] = { id: 'cmd', type: 'code' as never };
    expect(validate(def).valid).toBe(false);
  });

  it('依赖篡改：内容哈希随内容变化（防篡改）', () => {
    const a = maliciousWorkflow({ commandId: 'build' });
    const b = maliciousWorkflow({ commandId: 'build' });
    expect(computeWorkflowHash(a)).toBe(computeWorkflowHash(b));
    b.nodes[1] = { id: 'cmd', type: 'command', config: { commandId: 'evil' } };
    expect(computeWorkflowHash(a)).not.toBe(computeWorkflowHash(b));
  });

  it('路径穿越：BuilderWorkspace 拒绝 ../ 越界', () => {
    const ws = new BuilderWorkspace();
    try {
      expect(() => ws.writeFile('../evil.txt', 'x')).toThrow();
    } finally {
      ws.cleanup();
    }
  });

  it('消息伪造：iframe 非法消息被拒绝', () => {
    expect(validateIframeMessage({ source: 'evil', type: 'shell', payload: {} }).valid).toBe(false);
    expect(validateIframeMessage(null).valid).toBe(false);
    expect(
      validateIframeMessage({ source: 'meeting-minutes', type: 'render', payload: {} }).valid,
    ).toBe(true);
  });
});
