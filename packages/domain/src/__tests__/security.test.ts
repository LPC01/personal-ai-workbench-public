import { describe, expect, it } from 'vitest';
import { assertVisibility, isPathWithinRoot } from '../security.js';

describe('isPathWithinRoot（ROOM-SEC-008 路径越界校验）', () => {
  const root = 'D:/workbench/project-a';

  it('根内路径放行', () => {
    expect(isPathWithinRoot('D:/workbench/project-a/src/main.ts', root)).toBe(true);
    expect(isPathWithinRoot('D:/workbench/project-a', root)).toBe(true);
  });

  it('根外路径拒绝', () => {
    expect(isPathWithinRoot('D:/workbench/project-b/x.ts', root)).toBe(false);
  });

  it('路径穿越（..）拒绝', () => {
    expect(isPathWithinRoot('D:/workbench/project-a/../../secret', root)).toBe(false);
  });
});

describe('assertVisibility（ROOM-SEC-004 可见范围校验）', () => {
  const allowed = new Set(['designer', 'builder', 'reviewer']);

  it('全员可见放行', () => {
    expect(assertVisibility('builder', ['*'], allowed)).toBeNull();
  });

  it('允许参与者可见放行（含发布者本人）', () => {
    expect(assertVisibility('builder', ['builder', 'reviewer'], allowed)).toBeNull();
  });

  it('非参与者拒绝', () => {
    expect(assertVisibility('builder', ['intruder'], allowed)).toMatch(/非参与者 intruder/);
  });
});
