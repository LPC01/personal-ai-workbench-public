import type { ExtensionSpec } from '@workbench/contracts';

/** 标准 Extension 模板文件集（26 SPEC §15）。 */
export const EXTENSION_REQUIRED_FILES = [
  'AGENTS.md',
  'extension.yaml',
  'README.md',
  'TODO.md',
  'CHANGELOG.md',
  'docs/project-overview.md',
  'docs/architecture.md',
  'docs/development.md',
] as const;

/** 类型特有文档（§15）：assistant=面向用户 → user-guide；workflow=公共 API → component-api。 */
export function typeSpecificFiles(types: string[]): string[] {
  const files: string[] = [];
  if (types.includes('assistant')) {
    files.push('docs/user-guide.md');
  }
  if (types.includes('workflow')) {
    files.push('docs/component-api.md');
  }
  return files;
}

/** 把 ExtensionSpec 序列化为 extension.yaml（固定结构，简单 YAML）。 */
export function specToYaml(spec: ExtensionSpec): string {
  const lines: string[] = [];
  lines.push(`schemaVersion: ${spec.schemaVersion}`);
  lines.push('extension:');
  lines.push(`  id: ${spec.extension.id}`);
  lines.push(`  name: ${spec.extension.name}`);
  lines.push(`  version: ${spec.extension.version}`);
  lines.push(`  types: [${spec.extension.types.join(', ')}]`);
  lines.push('scope:');
  lines.push(`  install: ${spec.scope.install}`);
  lines.push(`  run: ${spec.scope.run}`);
  lines.push('permissions:');
  lines.push('  files:');
  lines.push(`    read: [${spec.permissions.files.read.join(', ')}]`);
  lines.push(`    write: [${spec.permissions.files.write.join(', ')}]`);
  lines.push(`  commands: [${spec.permissions.commands.join(', ')}]`);
  lines.push(`  network: ${spec.permissions.network}`);
  lines.push(`  credentials: [${spec.permissions.credentials.join(', ')}]`);
  if (spec.model) {
    lines.push('model:');
    lines.push(`  defaultProfileId: ${spec.model.defaultProfileId}`);
    if (spec.model.allowedProfileIds && spec.model.allowedProfileIds.length > 0) {
      lines.push(`  allowedProfileIds: [${spec.model.allowedProfileIds.join(', ')}]`);
    }
  }
  if (spec.entrypoints && spec.entrypoints.length > 0) {
    lines.push('entrypoints:');
    for (const entry of spec.entrypoints) {
      lines.push(`  - type: ${entry.type}`);
      lines.push(`    id: ${entry.id}`);
      if (entry.label) {
        lines.push(`    label: ${entry.label}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function baseContent(spec: ExtensionSpec): Record<string, string> {
  const id = spec.extension.id;
  const name = spec.extension.name;
  return {
    'AGENTS.md': `# ${name} — Agent 边界

- 本扩展仅在声明的 permissions 范围内操作，不得越界。
- 变更必须更新 CHANGELOG.md 并递增版本。
- 文档路由：设计见 docs/architecture.md，开发见 docs/development.md。
`,
    'extension.yaml': specToYaml(spec),
    'README.md': `# ${name}

扩展 ID：\`${id}\`，版本 \`${spec.extension.version}\`。

## 文档

- 概览：docs/project-overview.md
- 架构：docs/architecture.md
- 开发：docs/development.md
`,
    'TODO.md': `# 待办清单

记录计划中的事项，完成后移入 CHANGELOG.md。
`,
    'CHANGELOG.md': `# Changelog

## ${spec.extension.version}

- 初始版本。
`,
    'docs/project-overview.md': `# 项目概览

${name} 的目标与范围。
`,
    'docs/architecture.md': `# 架构

${name} 的组件与数据流。
`,
    'docs/development.md': `# 开发

构建、测试与发布流程。
`,
    'docs/user-guide.md': `# 使用指南

面向用户的 ${name} 使用说明。
`,
    'docs/component-api.md': `# 组件 API

${name} 的公共 API 说明。
`,
  };
}

/**
 * 按标准模板生成扩展包文件集（26 SPEC §15）。
 * 返回 `filename → content`，包含基础 8 文件 + 按类型附加文档（占位符-free）。
 */
export function scaffoldTemplateFiles(spec: ExtensionSpec): Record<string, string> {
  const all = baseContent(spec);
  const selected: Record<string, string> = {};
  for (const file of EXTENSION_REQUIRED_FILES) {
    selected[file] = all[file] ?? '';
  }
  for (const extra of typeSpecificFiles(spec.extension.types)) {
    selected[extra] = all[extra] ?? '';
  }
  return selected;
}
