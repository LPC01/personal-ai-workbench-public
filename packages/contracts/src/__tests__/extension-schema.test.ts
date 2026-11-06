import { describe, expect, it } from 'vitest';
import { createExtensionValidator } from '../extension-schema.js';
import type { ExtensionSpec } from '../extension.js';

function validSpec(): ExtensionSpec {
  return {
    schemaVersion: 'workbench.extension/v1',
    extension: {
      id: 'meeting-minutes',
      name: '会议纪要助手',
      version: '0.1.0',
      types: ['assistant'],
    },
    scope: { install: 'global', run: 'project' },
    permissions: {
      files: { read: ['inputs/**'], write: ['artifacts/**'] },
      commands: [],
      network: false,
      credentials: [],
    },
    model: { defaultProfileId: 'local-meeting' },
    entrypoints: [{ type: 'project-command', id: 'meeting-minutes.generate' }],
  };
}

describe('extension schema（workbench.extension/v1）', () => {
  it('校验合法 spec', () => {
    const validate = createExtensionValidator();
    const result = validate(validSpec());
    expect(result.valid).toBe(true);
  });

  it('拒绝非法版本号（非 SemVer）', () => {
    const validate = createExtensionValidator();
    const spec = validSpec();
    spec.extension.version = '1.0';
    expect(validate(spec).valid).toBe(false);
  });

  it('拒绝非法扩展 id（需小写+连字符 3 字符以上）', () => {
    const validate = createExtensionValidator();
    const spec = validSpec();
    spec.extension.id = 'Bad_ID';
    expect(validate(spec).valid).toBe(false);
  });

  it('拒绝缺 permissions 字段', () => {
    const validate = createExtensionValidator();
    const invalid = validSpec() as unknown as Record<string, unknown>;
    delete invalid.permissions;
    expect(validate(invalid).valid).toBe(false);
  });

  it('拒绝空 types', () => {
    const validate = createExtensionValidator();
    const spec = validSpec();
    spec.extension.types = [];
    expect(validate(spec).valid).toBe(false);
  });
});
