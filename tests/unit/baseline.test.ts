import { describe, expect, it } from 'vitest';

// 基线冒烟：验证 vitest + tsc strict 全链路可用
const baseline = {
  sum: (a: number, b: number): number => a + b,
  upper: (s: string): string => s.toUpperCase(),
};

describe('baseline smoke', () => {
  it('sums two numbers', () => {
    expect(baseline.sum(1, 2)).toBe(3);
  });

  it('uppercases a string', () => {
    expect(baseline.upper('workbench')).toBe('WORKBENCH');
  });
});
