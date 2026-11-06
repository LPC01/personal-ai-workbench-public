import { describe, expect, it } from 'vitest';
import { assertCommandAllowed, assertProjectScope } from '../command.js';

describe('assertCommandAllowed（§13.2 命令登记 + ToolPolicy）', () => {
  const registered = new Set(['start-web', 'run-tests']);
  const allowed = new Set(['start-web']);

  it('登记且允许的命令通过', () => {
    expect(assertCommandAllowed('start-web', allowed, registered)).toBeNull();
  });

  it('未登记命令拒绝', () => {
    expect(assertCommandAllowed('deploy', allowed, registered)).toMatch(/未在项目 Manifest 登记/);
  });

  it('登记但不在 ToolPolicy 允许集合拒绝', () => {
    expect(assertCommandAllowed('run-tests', allowed, registered)).toMatch(
      /不在 ToolPolicy 允许集合/,
    );
  });
});

describe('assertProjectScope（§13.6 多项目只读，写操作需标注项目）', () => {
  it('读操作无 projectId 放行', () => {
    expect(assertProjectScope(undefined, undefined, false)).toBeNull();
  });

  it('写操作无 projectId 拒绝', () => {
    expect(assertProjectScope(undefined, undefined, true)).toMatch(/明确标注目标项目/);
  });

  it('项目未绑定拒绝', () => {
    expect(assertProjectScope('p1', undefined, true)).toMatch(/未绑定到 Room/);
  });

  it('写操作但 read 权限拒绝', () => {
    expect(assertProjectScope('p1', 'read', true)).toMatch(/无执行权限/);
  });

  it('execute 权限写操作放行', () => {
    expect(assertProjectScope('p1', 'execute', true)).toBeNull();
  });
});
