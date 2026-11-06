import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BuilderWorkspace, createBuilderWorkspace } from '../builder-workspace.js';

const tmpDirs: string[] = [];

function newWorkspace(): BuilderWorkspace {
  const ws = createBuilderWorkspace();
  tmpDirs.push(ws.root);
  return ws;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('BuilderWorkspace（隔离 + 路径穿越防护）', () => {
  it('在隔离临时目录内读写文件', () => {
    const ws = newWorkspace();
    ws.writeFile('src/main.ts', 'export {}');
    expect(ws.readFile('src/main.ts')).toBe('export {}');
    expect(ws.root.includes('wb-builder-')).toBe(true);
  });

  it('拒绝路径穿越（../ 越界）', () => {
    const ws = newWorkspace();
    expect(() => ws.resolve('../outside.txt')).toThrow();
    expect(() => ws.writeFile('../../etc/passwd', 'x')).toThrow();
  });

  it('拒绝绝对路径越界', () => {
    const ws = newWorkspace();
    const outside = mkdtempSync(join(tmpdir(), 'wb-out-'));
    tmpDirs.push(outside);
    expect(() => ws.resolve(join(outside, 'x.txt'))).toThrow();
  });

  it('cleanup 清理后不可再写', () => {
    const ws = newWorkspace();
    ws.cleanup();
    expect(() => ws.writeFile('a.txt', 'x')).toThrow(/已清理/);
  });

  it('子目录路径仍在根内', () => {
    const ws = newWorkspace();
    ws.writeFile('a/b/c.txt', 'ok');
    expect(ws.readFile('a/b/c.txt')).toBe('ok');
  });
});
