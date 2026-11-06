import { describe, expect, it } from 'vitest';
import { badgeToneClass, statusBadgeTone } from '../ui/Badge';
import { cx } from '../ui/cx';

describe('cx', () => {
  it('拼接有效类名并跳过假值', () => {
    expect(cx('a', 'b')).toBe('a b');
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('全为假值时返回空串', () => {
    expect(cx(false, null, undefined)).toBe('');
  });
});

describe('statusBadgeTone', () => {
  it('成功类状态映射到 success', () => {
    for (const s of ['RUNNING', 'SUCCEEDED', 'OK', 'RESOLVED', 'VERIFIED']) {
      expect(statusBadgeTone(s)).toBe('success');
    }
  });

  it('失败类状态映射到 danger', () => {
    for (const s of ['FAILED', 'UNHEALTHY', 'ERROR', 'DOWN']) {
      expect(statusBadgeTone(s)).toBe('danger');
    }
  });

  it('进行中/未决类状态映射到 warn', () => {
    for (const s of ['PENDING', 'STARTING', 'PAUSED', 'OPEN', 'DEGRADED']) {
      expect(statusBadgeTone(s)).toBe('warn');
    }
  });

  it('停止/未知映射到 neutral', () => {
    expect(statusBadgeTone('STOPPED')).toBe('neutral');
    expect(statusBadgeTone('UNKNOWN')).toBe('neutral');
  });

  it('未收录状态回落 info，不臆造语义', () => {
    expect(statusBadgeTone('SOMETHING_NEW')).toBe('info');
    expect(statusBadgeTone(null)).toBe('info');
    expect(statusBadgeTone(undefined)).toBe('info');
  });

  it('大小写与前后空格不敏感', () => {
    expect(statusBadgeTone(' running ')).toBe('success');
  });
});

describe('badgeToneClass', () => {
  it('始终带基础类名，且色调类不同', () => {
    expect(badgeToneClass('neutral')).toBe('wb-badge wb-badge--neutral');
    expect(badgeToneClass('danger')).toBe('wb-badge wb-badge--danger');
  });
});
