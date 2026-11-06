import { describe, expect, it } from 'vitest';
import { isSafeUrl, safeUrlTransform } from '../MarkdownView';

/**
 * README 渲染的协议白名单（PROJ-UI-01）。
 * README 来自「任意登记的项目目录」，属于不可信输入：`javascript:` / `data:`
 * 必须被拦下，否则点一下就是 XSS。
 */
describe('isSafeUrl 协议白名单', () => {
  it('放行 http / https / mailto', () => {
    expect(isSafeUrl('https://example.com/a?b=1')).toBe(true);
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('mailto:a@b.com')).toBe(true);
  });

  it('拦截脚本与 data 协议', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeUrl('file:///C:/secret.txt')).toBe(false);
  });

  it('拦截相对路径（在工作台域内点了必然 404）', () => {
    expect(isSafeUrl('./docs/guide.md')).toBe(false);
    expect(isSafeUrl('/docs/guide.md')).toBe(false);
    expect(isSafeUrl('docs/guide.md')).toBe(false);
  });

  it('空串与畸形输入一律不安全', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('   ')).toBe(false);
  });
});

describe('safeUrlTransform', () => {
  it('安全 URL 原样返回（不篡改）', () => {
    expect(safeUrlTransform('https://example.com/a')).toBe('https://example.com/a');
  });

  it('不安全 URL 返回空串（不生成 href / src）', () => {
    expect(safeUrlTransform('javascript:alert(1)')).toBe('');
    expect(safeUrlTransform('./local.md')).toBe('');
  });
});
