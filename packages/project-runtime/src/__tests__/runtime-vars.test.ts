import { describe, expect, it } from 'vitest';
import {
  resolveCommandArguments,
  resolveCommandCwd,
  resolveRuntimeVariables,
} from '../runtime-vars.js';

describe('resolveRuntimeVariables', () => {
  const ctx = { projectRoot: 'D:\\workbench\\proj', port: 8213 };

  it('resolves all platform variables', () => {
    expect(resolveRuntimeVariables('http://127.0.0.1:${runtime.port}/health', ctx)).toBe(
      'http://127.0.0.1:8213/health',
    );
    expect(resolveRuntimeVariables('${project.root}\\scripts', ctx)).toBe(
      'D:\\workbench\\proj\\scripts',
    );
    expect(resolveRuntimeVariables('legacy ${port}', ctx)).toBe('legacy 8213');
  });

  it('returns unchanged when no variable present', () => {
    expect(resolveRuntimeVariables('node', ctx)).toBe('node');
  });
});

describe('resolveCommandCwd', () => {
  it('defaults to project root when undefined', () => {
    expect(resolveCommandCwd(undefined, { projectRoot: 'D:\\r', port: 0 })).toBe('D:\\r');
  });

  it('substitutes ${project.root}', () => {
    expect(resolveCommandCwd('${project.root}', { projectRoot: 'D:\\r', port: 0 })).toBe('D:\\r');
  });

  it('resolves relative path against project root', () => {
    const result = resolveCommandCwd('scripts', { projectRoot: 'D:\\r', port: 0 });
    expect(result).toBe('D:\\r\\scripts');
  });
});

describe('resolveCommandArguments', () => {
  it('resolves variables in each argument', () => {
    expect(
      resolveCommandArguments(['--file', '${project.root}\\a.txt', '${runtime.port}'], {
        projectRoot: 'D:\\r',
        port: 9,
      }),
    ).toEqual(['--file', 'D:\\r\\a.txt', '9']);
  });

  it('returns undefined for undefined input', () => {
    expect(resolveCommandArguments(undefined, { projectRoot: 'D:\\r', port: 0 })).toBeUndefined();
  });
});
