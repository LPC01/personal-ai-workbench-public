import type { MemoryProvider, MemoryScope, ResourceRef } from '@workbench/contracts';

/**
 * DSH Memory Bundle 只读召回（26 SPEC §14.2：先读摘要/索引再按需读全文）。
 * SPEC 未定义 DSH Bundle 具体格式，按 MemoryProvider 契约实现通用 Bundle：
 * - JSON：`[{ uri, content, scope }]` 或 `{ documents: [...] }`
 * - Markdown：每个 `## 标题` 为一个条目（标题为 uri，正文为 content）
 */

export interface MemoryBundleDocument {
  uri: string;
  content: string;
  scope?: MemoryScope;
}

/** 解析 JSON Bundle。 */
export function parseJsonBundle(content: string): MemoryBundleDocument[] {
  const data = JSON.parse(content) as unknown;
  const list = Array.isArray(data)
    ? (data as { uri?: string; content?: string; scope?: MemoryScope }[])
    : ((data as { documents?: { uri?: string; content?: string; scope?: MemoryScope }[] })
        .documents ?? []);
  return list.map((d) => ({
    uri: String(d.uri ?? ''),
    content: String(d.content ?? ''),
    scope: d.scope ?? 'project',
  }));
}

/** 解析 Markdown Bundle（`## 标题` 为条目）。 */
export function parseMarkdownBundle(content: string): MemoryBundleDocument[] {
  const docs: MemoryBundleDocument[] = [];
  const sections = content.split(/(?=^## )/m);
  for (const section of sections) {
    const titleMatch = /^## (.+)$/m.exec(section);
    if (!titleMatch) {
      continue;
    }
    const uri = (titleMatch[1] as string).trim();
    const body = section.replace(/^## .+$/m, '').trim();
    if (uri.length > 0) {
      docs.push({ uri, content: body, scope: 'project' });
    }
  }
  return docs;
}

/** 只读导入 Bundle（indexResource，不修改源）。 */
export async function importMemoryBundle(
  provider: MemoryProvider,
  docs: MemoryBundleDocument[],
): Promise<ResourceRef[]> {
  const refs: ResourceRef[] = [];
  for (const doc of docs) {
    refs.push(
      await provider.indexResource({
        uri: doc.uri,
        content: doc.content,
        scope: doc.scope ?? 'project',
      }),
    );
  }
  return refs;
}
