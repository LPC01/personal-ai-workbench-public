import type { ExportBundle } from '@workbench/contracts';
import { parseMarkdownBundle, type MemoryBundleDocument } from './memory-bundle.js';

/**
 * Markdown 降级（26 SPEC §14.1：必须提供最小 Markdown 降级实现）。
 * ExportBundle ⇄ Markdown 往返。
 */

/** ExportBundle → Markdown（`## uri` + 正文）。 */
export function bundleToMarkdown(bundle: ExportBundle): string {
  const parts = bundle.documents.map((d) => `## ${d.uri}\n${d.content}`);
  if (parts.length === 0) {
    return `## scope: ${bundle.scope}\n（空）\n`;
  }
  return parts.join('\n\n');
}

/** Markdown → bundle 文档（复用 Markdown Bundle 解析）。 */
export function markdownToBundle(
  scope: ExportBundle['scope'],
  markdown: string,
): MemoryBundleDocument[] {
  return parseMarkdownBundle(markdown).map((d) => ({ ...d, scope }));
}
