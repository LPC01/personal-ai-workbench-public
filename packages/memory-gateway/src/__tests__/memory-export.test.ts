import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bundleToMarkdown, markdownToBundle } from '../markdown-export.js';
import { SqliteMemoryProvider } from '../sqlite-memory-provider.js';

const tmpDirs: string[] = [];
const providers: SqliteMemoryProvider[] = [];

function newSqliteProvider(): SqliteMemoryProvider {
  const dir = mkdtempSync(join(tmpdir(), 'wb-sqlmem-'));
  tmpDirs.push(dir);
  const provider = new SqliteMemoryProvider(join(dir, 'mem.db'));
  providers.push(provider);
  return provider;
}

afterEach(() => {
  while (providers.length > 0) {
    providers.pop()?.close();
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Markdown 降级（§14.1）', () => {
  it('ExportBundle → Markdown → bundle 往返', () => {
    const bundle = {
      scope: 'project' as const,
      documents: [
        { uri: 'res:1', content: '经验一', scope: 'project' as const },
        { uri: 'res:2', content: '经验二', scope: 'project' as const },
      ],
    };
    const markdown = bundleToMarkdown(bundle);
    expect(markdown).toContain('## res:1');
    expect(markdown).toContain('经验一');

    const docs = markdownToBundle('project', markdown);
    expect(docs).toHaveLength(2);
    expect(docs[0]?.uri).toBe('res:1');
  });
});

describe('SQLite 降级（§14.1）', () => {
  it('索引 + 召回 + 导出', async () => {
    const provider = newSqliteProvider();

    await provider.indexResource({ uri: 'res:1', content: '数据交换空间经验', scope: 'project' });
    const hits = await provider.search({ query: '数据交换', scope: 'project' });
    expect(hits.some((h) => h.uri === 'res:1')).toBe(true);

    const bundle = await provider.export('project');
    expect(bundle.documents).toHaveLength(1);
  });

  it('revoke 后不召回', async () => {
    const provider = newSqliteProvider();
    await provider.indexResource({ uri: 'a', content: '被撤销', scope: 'project' });
    await provider.revoke({ uri: 'a' });
    const hits = await provider.search({ query: '被撤销', scope: 'project' });
    expect(hits).toHaveLength(0);
  });
});
