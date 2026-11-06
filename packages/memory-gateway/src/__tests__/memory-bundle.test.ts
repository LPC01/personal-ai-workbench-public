import { describe, expect, it } from 'vitest';
import { InMemoryMemoryProvider } from '../in-memory-provider.js';
import { importMemoryBundle, parseJsonBundle, parseMarkdownBundle } from '../memory-bundle.js';

describe('DSH Memory Bundle 只读召回（§14.2）', () => {
  it('解析 JSON Bundle 并召回', async () => {
    const provider = new InMemoryMemoryProvider();
    const docs = parseJsonBundle(
      JSON.stringify({
        documents: [
          { uri: 'ds:1', content: '数据交换空间最佳实践', scope: 'project' },
          { uri: 'ds:2', content: '无关' },
        ],
      }),
    );
    await importMemoryBundle(provider, docs);
    const hits = await provider.search({ query: '数据交换', scope: 'project' });
    expect(hits.some((h) => h.uri === 'ds:1')).toBe(true);
  });

  it('解析 Markdown Bundle（## 标题为条目）', () => {
    const docs = parseMarkdownBundle('## lesson-1\n会议纪要经验\n\n## lesson-2\n另一条');
    expect(docs).toHaveLength(2);
    expect(docs[0]?.uri).toBe('lesson-1');
    expect(docs[0]?.content).toBe('会议纪要经验');
  });

  it('数组形式 JSON Bundle 也可解析', () => {
    const docs = parseJsonBundle(JSON.stringify([{ uri: 'a', content: 'x' }]));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.uri).toBe('a');
  });

  it('只读召回：导入不修改 provider 已有数据之外', async () => {
    const provider = new InMemoryMemoryProvider();
    await importMemoryBundle(provider, [{ uri: 'b1', content: '旧数据' }]);
    const before = await provider.search({ query: '旧数据' });
    expect(before).toHaveLength(1);
    await importMemoryBundle(provider, [{ uri: 'b2', content: '新数据' }]);
    const after = await provider.search({ query: '新数据' });
    expect(after).toHaveLength(1);
  });
});
