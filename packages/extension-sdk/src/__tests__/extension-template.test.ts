import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExtensionSpec } from '@workbench/contracts';
import {
  EXTENSION_REQUIRED_FILES,
  scaffoldTemplateFiles,
  specToYaml,
  typeSpecificFiles,
} from '../extension-template.js';
import { checkExtensionDocs } from '../extension-doc-checker.js';

const tmpDirs: string[] = [];

function spec(types: ExtensionSpec['extension']['types']): ExtensionSpec {
  return {
    schemaVersion: 'workbench.extension/v1',
    extension: { id: 'meeting-minutes', name: '会议纪要助手', version: '0.1.0', types },
    scope: { install: 'global', run: 'project' },
    permissions: {
      files: { read: ['inputs/**'], write: ['artifacts/**'] },
      commands: [],
      network: false,
      credentials: [],
    },
    model: { defaultProfileId: 'local-meeting' },
    entrypoints: [
      { type: 'project-command', id: 'meeting-minutes.generate', label: '整理会议纪要' },
    ],
  };
}

function writePackage(specArg: ExtensionSpec): string {
  const dir = join(tmpdir(), `wb-extdoc-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  for (const [file, content] of Object.entries(scaffoldTemplateFiles(specArg))) {
    const full = join(dir, file);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('标准 Extension 模板（§15）', () => {
  it('scaffold 生成全部必需文件', () => {
    const files = scaffoldTemplateFiles(spec(['assistant']));
    for (const f of EXTENSION_REQUIRED_FILES) {
      expect(files[f]).toBeTruthy();
    }
  });

  it('assistant 类型附加 user-guide，workflow 附加 component-api', () => {
    expect(typeSpecificFiles(['assistant'])).toContain('docs/user-guide.md');
    expect(typeSpecificFiles(['workflow'])).toContain('docs/component-api.md');
    expect(scaffoldTemplateFiles(spec(['assistant']))['docs/user-guide.md']).toBeTruthy();
  });

  it('specToYaml 生成含 schemaVersion 与版本的 YAML', () => {
    const yaml = specToYaml(spec(['assistant']));
    expect(yaml).toContain('schemaVersion: workbench.extension/v1');
    expect(yaml).toContain('version: 0.1.0');
    expect(yaml).toContain('entrypoints:');
  });
});

describe('扩展文档验证器（§15）', () => {
  it('scaffold 产物通过验证', () => {
    const dir = writePackage(spec(['assistant']));
    const result = checkExtensionDocs(dir, spec(['assistant']));
    expect(result.valid).toBe(true);
  });

  it('缺必需文件时验证失败', () => {
    const dir = writePackage(spec(['assistant']));
    rmSync(join(dir, 'docs', 'architecture.md'), { force: true });
    const result = checkExtensionDocs(dir, spec(['assistant']));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.file === 'docs/architecture.md')).toBe(true);
  });

  it('缺类型特有文档时验证失败', () => {
    const dir = writePackage(spec(['assistant']));
    rmSync(join(dir, 'docs', 'user-guide.md'), { force: true });
    const result = checkExtensionDocs(dir, spec(['assistant']));
    expect(result.issues.some((i) => i.file === 'docs/user-guide.md')).toBe(true);
  });

  it('占位符内容被标记', () => {
    const dir = writePackage(spec(['assistant']));
    writeFileSync(join(dir, 'docs', 'architecture.md'), '# 架构\nTODO: 待补\n', 'utf8');
    const result = checkExtensionDocs(dir, spec(['assistant']));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === 'placeholder')).toBe(true);
  });
});
