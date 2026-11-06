import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readProjectReadme, README_CANDIDATES, README_MAX_BYTES } from '../project-readme.js';

const tmpDirs: string[] = [];

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wb-readme-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('readProjectReadme', () => {
  it('命中顶层 README.md 并返回正文', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'README.md'), '# 标题\n\n正文内容', 'utf8');
    const result = readProjectReadme(root);
    expect(result.found).toBe(true);
    expect(result.fileName).toBe('README.md');
    expect(result.content).toContain('正文内容');
    expect(result.truncated).toBe(false);
  });

  it('大小写变体 readme.md / Readme.md 同样命中', () => {
    const lower = tmpRoot();
    writeFileSync(join(lower, 'readme.md'), 'lower', 'utf8');
    expect(readProjectReadme(lower).content).toBe('lower');

    const title = tmpRoot();
    writeFileSync(join(title, 'Readme.md'), 'title', 'utf8');
    expect(readProjectReadme(title).content).toBe('title');
  });

  it('退化扩展名 README.markdown / README.txt 按优先级命中', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'README.txt'), 'txt', 'utf8');
    expect(readProjectReadme(root).content).toBe('txt');

    const second = tmpRoot();
    writeFileSync(join(second, 'README.markdown'), 'markdown', 'utf8');
    expect(readProjectReadme(second).fileName).toBe('README.markdown');
  });

  it('README.md 优先于 readme.txt（候选顺序稳定）', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'README.md'), 'md', 'utf8');
    writeFileSync(join(root, 'README.txt'), 'txt', 'utf8');
    expect(readProjectReadme(root).fileName).toBe('README.md');
    expect(README_CANDIDATES[0]).toBe('README.md');
  });

  it('没有自述文件时返回明确空态（不抛错）', () => {
    const root = tmpRoot();
    const result = readProjectReadme(root);
    expect(result).toEqual({ found: false });
    expect(result.content).toBeUndefined();
  });

  it('目录根不存在时同样是空态', () => {
    const root = join(tmpRoot(), 'not-created');
    expect(readProjectReadme(root)).toEqual({ found: false });
  });

  it('同名目录不算命中（只接受普通文件）', () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'README.md'));
    expect(readProjectReadme(root).found).toBe(false);
  });

  it('不读取子目录里的自述文件（不下钻）', () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'README.md'), 'nested', 'utf8');
    expect(readProjectReadme(root).found).toBe(false);
  });

  it('probe 模式只回元信息，不传输正文', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'README.md'), '# 标题', 'utf8');
    const result = readProjectReadme(root, { withContent: false });
    expect(result.found).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.content).toBeUndefined();
  });

  it('超出上限的内容被截断并如实标记', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'README.md'), 'x'.repeat(4096), 'utf8');
    const result = readProjectReadme(root, { maxBytes: 1024 });
    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(1024);
    expect(result.sizeBytes).toBe(4096);
  });

  it('默认上限为 README_MAX_BYTES 且不被默认值截断', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'README.md'), 'y'.repeat(2048), 'utf8');
    const result = readProjectReadme(root);
    expect(README_MAX_BYTES).toBe(256 * 1024);
    expect(result.truncated).toBe(false);
    expect(result.content).toHaveLength(2048);
  });
});
