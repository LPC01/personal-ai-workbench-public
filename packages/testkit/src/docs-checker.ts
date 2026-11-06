import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export type DocRule = 'broken-link' | 'placeholder' | 'version';

export interface DocIssue {
  file: string;
  line: number;
  rule: DocRule;
  message: string;
}

export interface CheckDocsResult {
  filesChecked: number;
  issues: DocIssue[];
}

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bTODO\b/,
  /\bTBD\b/,
  /\bFIXME\b/,
  /\bXXX\b/,
  /\bTBC\b/,
  /\bPLACEHOLDER\b/i,
  /\bLorem ipsum\b/i,
  /占位(?!符)/,
  /待定/,
  /待补/,
  /待完善/,
];

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const LINK_PATTERN = /\[[^\]]*\]\(([^)]+)\)/g;

function isMarkdown(path: string): boolean {
  return path.endsWith('.md');
}

function listMarkdownFiles(root: string): string[] {
  const result: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist' && entry !== '.git') {
          stack.push(full);
        }
      } else if (isMarkdown(full)) {
        result.push(full);
      }
    }
  }
  return result.sort();
}

function checkBrokenLinks(file: string, lines: string[], displayBase: string): DocIssue[] {
  const issues: DocIssue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    LINK_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINK_PATTERN.exec(line)) !== null) {
      const raw = (m[1] ?? '').trim();
      const target = raw.split(/\s+/)[0] ?? '';
      if (
        target === '' ||
        target.startsWith('http://') ||
        target.startsWith('https://') ||
        target.startsWith('#') ||
        target.startsWith('mailto:')
      ) {
        continue;
      }
      const hashIndex = target.indexOf('#');
      const pathPart = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
      if (pathPart === '') {
        continue;
      }
      const resolved = resolve(dirname(file), pathPart);
      if (!existsSync(resolved)) {
        issues.push({
          file: relative(displayBase, file),
          line: i + 1,
          rule: 'broken-link',
          message: `broken link: ${target}`,
        });
      }
    }
  }
  return issues;
}

function checkPlaceholders(file: string, lines: string[], displayBase: string): DocIssue[] {
  const issues: DocIssue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(line)) {
        issues.push({
          file: relative(displayBase, file),
          line: i + 1,
          rule: 'placeholder',
          message: `placeholder marker: ${pattern.source}`,
        });
        break;
      }
    }
  }
  return issues;
}

function checkVersion(file: string, lines: string[], displayBase: string): DocIssue[] {
  if ((lines[0] ?? '').trim() !== '---') {
    return [];
  }
  const endIndex = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (endIndex < 0) {
    return [];
  }
  const issues: DocIssue[] = [];
  const frontmatter = lines.slice(1, endIndex);
  for (let i = 0; i < frontmatter.length; i++) {
    const m = /^version:\s*(.+)$/.exec(frontmatter[i] ?? '');
    if (m) {
      const version = (m[1] ?? '').trim();
      if (!VERSION_PATTERN.test(version)) {
        issues.push({
          file: relative(displayBase, file),
          line: i + 2,
          rule: 'version',
          message: `invalid version format (expected X.Y.Z): ${version}`,
        });
      }
    }
  }
  return issues;
}

/**
 * 检查指定路径（文件或目录）下的 Markdown 文档：坏链接、占位符、版本一致性。
 * `baseDir` 用于 issue 中的相对路径显示（默认取 root）。
 */
export function checkDocs(root: string, options: { baseDir?: string } = {}): CheckDocsResult {
  const absRoot = resolve(root);
  const displayBase = options.baseDir ? resolve(options.baseDir) : absRoot;

  const st = statSync(absRoot);
  const files = st.isDirectory()
    ? listMarkdownFiles(absRoot)
    : isMarkdown(absRoot)
      ? [absRoot]
      : [];

  const issues: DocIssue[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    issues.push(...checkBrokenLinks(file, lines, displayBase));
    issues.push(...checkPlaceholders(file, lines, displayBase));
    issues.push(...checkVersion(file, lines, displayBase));
  }
  return { filesChecked: files.length, issues };
}
