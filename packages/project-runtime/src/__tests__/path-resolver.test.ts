import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@workbench/domain';
import { resolveWithinRoot } from '../path-resolver.js';

const tmpDirs: string[] = [];

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wb-path-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveWithinRoot', () => {
  it('resolves a relative path inside the root', () => {
    const root = makeTmp();
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'sub', 'a.txt'), 'x');
    expect(resolveWithinRoot(root, 'sub/a.txt')).toBe(join(root, 'sub', 'a.txt'));
  });

  it('resolves an absolute path inside the root', () => {
    const root = makeTmp();
    mkdirSync(join(root, 'sub'));
    expect(resolveWithinRoot(root, join(root, 'sub'))).toBe(join(root, 'sub'));
  });

  it('rejects a path traversal outside the root', () => {
    const root = makeTmp();
    const parent = join(root, '..');
    let code: string | undefined;
    try {
      resolveWithinRoot(root, parent);
    } catch (e) {
      code = (e as AppError).code;
    }
    expect(code).toBe('PATH_OUTSIDE_ROOT');
  });

  it('rejects a junction pointing outside the root', () => {
    const root = makeTmp();
    const outside = makeTmp();
    mkdirSync(join(outside, 'secret'));
    try {
      symlinkSync(join(outside, 'secret'), join(root, 'link'), 'junction');
    } catch {
      return; // 环境不支持 junction，跳过
    }
    let code: string | undefined;
    try {
      resolveWithinRoot(root, 'link');
    } catch (e) {
      code = (e as AppError).code;
    }
    expect(code).toBe('PATH_OUTSIDE_ROOT');
  });

  it('resolves a not-yet-created leaf without throwing a raw fs error', () => {
    const root = makeTmp();
    expect(resolveWithinRoot(root, 'not-created-yet/sub')).toBe(
      join(root, 'not-created-yet', 'sub'),
    );
  });

  it('still rejects a non-existent path whose nearest ancestor escapes the root', () => {
    const root = makeTmp();
    let code: string | undefined;
    try {
      resolveWithinRoot(root, join('..', 'outside', 'nope'));
    } catch (e) {
      code = (e as AppError).code;
    }
    expect(code).toBe('PATH_OUTSIDE_ROOT');
  });
});
