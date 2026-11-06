import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionSpec } from '@workbench/contracts';
import { checkDocs, type DocIssue } from '@workbench/testkit';
import { EXTENSION_REQUIRED_FILES, typeSpecificFiles } from './extension-template.js';

/** 扩展文档问题。 */
export interface ExtensionDocIssue {
  file: string;
  rule: string;
  message: string;
}

export interface CheckExtensionDocsResult {
  valid: boolean;
  issues: ExtensionDocIssue[];
}

/** 把 testkit 的 DocIssue 归一化为扩展文档问题。 */
function toExtensionIssue(issue: DocIssue): ExtensionDocIssue {
  return { file: issue.file, rule: issue.rule, message: issue.message };
}

/**
 * 扩展包文档验证器（26 SPEC §15）。
 * 检查：必需文件存在性、类型特有文档、extension.yaml 内容、以及 Markdown 的坏链接/占位符/版本。
 */
export function checkExtensionDocs(root: string, spec?: ExtensionSpec): CheckExtensionDocsResult {
  const issues: ExtensionDocIssue[] = [];

  // 1. 必需文件
  for (const file of EXTENSION_REQUIRED_FILES) {
    if (!existsSync(join(root, file))) {
      issues.push({ file, rule: 'missing-file', message: `缺少必需文件: ${file}` });
    }
  }

  // 2. 类型特有文档
  if (spec) {
    for (const extra of typeSpecificFiles(spec.extension.types)) {
      if (!existsSync(join(root, extra))) {
        issues.push({ file: extra, rule: 'missing-file', message: `缺少类型特有文档: ${extra}` });
      }
    }
  }

  // 3. extension.yaml 内容（轻量校验 schemaVersion）
  const yamlPath = join(root, 'extension.yaml');
  if (existsSync(yamlPath)) {
    const content = readFileSync(yamlPath, 'utf8');
    if (!content.includes('schemaVersion: workbench.extension/v1')) {
      issues.push({
        file: 'extension.yaml',
        rule: 'invalid-yaml',
        message: 'extension.yaml 缺少 schemaVersion: workbench.extension/v1',
      });
    }
  }

  // 4. Markdown 坏链接/占位符/版本
  if (existsSync(root)) {
    const md = checkDocs(root);
    issues.push(...md.issues.map(toExtensionIssue));
  }

  return { valid: issues.length === 0, issues };
}
