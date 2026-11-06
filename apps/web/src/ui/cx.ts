/** 类名拼接：过滤掉 false / null / undefined / 空串，避免模板字符串产生双空格。 */

export type ClassValue = string | false | null | undefined;

export function cx(...parts: ClassValue[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}
