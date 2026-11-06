import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@workbench/domain';
import {
  assertExecutableAllowed,
  DEFAULT_ALLOWED_EXECUTABLES,
  isExecutableAllowed,
  normalizeExecutableName,
  resolveExecutablePolicy,
} from '../executable-policy.js';

const tmpDirs: string[] = [];

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wb-exe-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('normalizeExecutableName', () => {
  it('strips directory, .exe suffix and case', () => {
    expect(normalizeExecutableName('C:/Program Files/nodejs/NODE.EXE')).toBe('node');
    expect(normalizeExecutableName('powershell.exe')).toBe('powershell');
    expect(normalizeExecutableName('npm')).toBe('npm');
  });
});

describe('resolveExecutablePolicy', () => {
  it('defaults to the built-in set and rejects others', () => {
    const policy = resolveExecutablePolicy({});
    for (const name of DEFAULT_ALLOWED_EXECUTABLES) {
      expect(policy.allowed.has(name)).toBe(true);
    }
    expect(policy.allowed.has('calc')).toBe(false);
  });

  it('extends via WB_ALLOWED_EXECUTABLES (trimmed + normalized)', () => {
    const policy = resolveExecutablePolicy({ WB_ALLOWED_EXECUTABLES: ' Docker.exe , rustc ' });
    expect(policy.allowed.has('docker')).toBe(true);
    expect(policy.allowed.has('rustc')).toBe(true);
    expect(policy.allowed.has('node')).toBe(true);
  });

  it('ignores an empty WB_ALLOWED_EXECUTABLES', () => {
    const policy = resolveExecutablePolicy({ WB_ALLOWED_EXECUTABLES: ' , ' });
    expect(policy.allowed.size).toBe(DEFAULT_ALLOWED_EXECUTABLES.length);
  });
});

describe('isExecutableAllowed', () => {
  it('allows bare names on the allowlist', () => {
    const policy = resolveExecutablePolicy({});
    expect(isExecutableAllowed('node', policy)).toBe(true);
    expect(isExecutableAllowed('npm', policy)).toBe(true);
  });

  it('allows an absolute path whose basename is on the allowlist', () => {
    const policy = resolveExecutablePolicy({});
    expect(isExecutableAllowed(process.execPath, policy)).toBe(true);
  });

  it('rejects shells and unlisted system programs', () => {
    const policy = resolveExecutablePolicy({});
    expect(isExecutableAllowed('cmd.exe', policy)).toBe(false);
    expect(isExecutableAllowed('bash', policy)).toBe(false);
    expect(isExecutableAllowed('C:/Windows/System32/calc.exe', policy)).toBe(false);
  });

  it('rejects empty names and names containing a nul byte', () => {
    const policy = resolveExecutablePolicy({});
    expect(isExecutableAllowed('', policy)).toBe(false);
    expect(isExecutableAllowed('no\0de', policy)).toBe(false);
  });

  it('allows a project-local absolute path inside the controlled root', () => {
    const policy = resolveExecutablePolicy({});
    const root = makeTmp();
    mkdirSync(join(root, 'bin'));
    expect(isExecutableAllowed(join(root, 'bin', 'tool.exe'), policy, root)).toBe(true);
  });

  it('rejects an absolute path outside the controlled root', () => {
    const policy = resolveExecutablePolicy({});
    const root = makeTmp();
    const outside = makeTmp();
    mkdirSync(join(outside, 'bin'));
    expect(isExecutableAllowed(join(outside, 'bin', 'evil.exe'), policy, root)).toBe(false);
  });

  it('rejects a relative path carrying separators', () => {
    const policy = resolveExecutablePolicy({});
    const root = makeTmp();
    expect(isExecutableAllowed('../evil.exe', policy, root)).toBe(false);
  });
});

describe('assertExecutableAllowed', () => {
  it('throws COMMAND_NOT_REGISTERED for an unlisted program', () => {
    let code: string | undefined;
    try {
      assertExecutableAllowed('calc.exe', resolveExecutablePolicy({}));
    } catch (e) {
      code = (e as AppError).code;
    }
    expect(code).toBe('COMMAND_NOT_REGISTERED');
  });

  it('does not throw for an allowed program', () => {
    expect(() => assertExecutableAllowed('node', resolveExecutablePolicy({}))).not.toThrow();
  });
});
