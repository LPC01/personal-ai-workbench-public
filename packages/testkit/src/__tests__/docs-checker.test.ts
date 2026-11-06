import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDocs } from '../docs-checker.js';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wb-docs-'));
  tmpDirs.push(dir);
  return dir;
}

function write(dir: string, rel: string, content: string): void {
  writeFileSync(join(dir, rel), content, 'utf8');
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('checkDocs', () => {
  it('reports broken internal links (intentional interception)', () => {
    const dir = makeTmpDir();
    write(dir, 'a.md', '# A\n\n[missing](./missing.md)\n');
    const result = checkDocs(dir);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.rule).toBe('broken-link');
    expect(result.issues[0]?.file).toBe('a.md');
  });

  it('ignores external links, anchors and mailto', () => {
    const dir = makeTmpDir();
    write(dir, 'a.md', '# A\n\n[ext](https://example.com) [anchor](#sec) [mail](mailto:a@b.c)\n');
    expect(checkDocs(dir).issues).toEqual([]);
  });

  it('reports placeholder markers (intentional interception)', () => {
    const dir = makeTmpDir();
    write(dir, 'a.md', '# A\n\nTODO: implement\n占位内容\n');
    const result = checkDocs(dir);
    const placeholders = result.issues.filter((i) => i.rule === 'placeholder');
    expect(placeholders).toHaveLength(2);
  });

  it('reports invalid frontmatter version, accepts valid semver', () => {
    const dir = makeTmpDir();
    write(dir, 'bad.md', '---\ntitle: x\nversion: 1.0\n---\nbody\n');
    write(dir, 'good.md', '---\ntitle: y\nversion: 1.0.0\n---\nbody\n');
    const result = checkDocs(dir);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.rule).toBe('version');
    expect(result.issues[0]?.file).toBe('bad.md');
  });

  it('passes a clean document', () => {
    const dir = makeTmpDir();
    write(dir, 'ok.md', '# OK\n\n[target](./target.md)\n');
    write(dir, 'target.md', '# Target\n');
    const result = checkDocs(dir);
    expect(result.filesChecked).toBe(2);
    expect(result.issues).toEqual([]);
  });
});
