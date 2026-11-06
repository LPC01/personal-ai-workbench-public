import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { AppError } from '@workbench/domain';

/**
 * 真实路径解析：对目标做 realpath；若目标或其祖先不存在，则回退到
 * 「最近存在的祖先」的 realpath，再拼回剩余片段。
 *
 * 必要性：`resolveWithinRoot` 用于校验 cwd 一类**可能尚未创建**的路径。
 * 若直接用 `realpathSync`，一个还不存在的 cwd 会先抛 ENOENT 原始 fs 错误，
 * 使包含关系判断失效（错误码也不是 PATH_OUTSIDE_ROOT）。
 */
function realpathNearest(target: string): string {
  let current = resolve(target);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length > 0 ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        // 直到文件系统根都不存在：按字面路径处理（无真实节点可解析）。
        return resolve(target);
      }
      tail.push(basename(current));
      current = parent;
    }
  }
}

/**
 * 受控路径解析（26 SPEC §16 SEC-002 / §5）：把输入路径解析为真实绝对路径，
 * 并确保其处于受控根内。符号链接/junction 指向根外时抛 PATH_OUTSIDE_ROOT。
 * 目标不存在时仍解析其最近存在祖先并做包含判断（不抛原始 fs 错误）。
 */
export function resolveWithinRoot(root: string, input: string): string {
  const absRoot = realpathNearest(resolve(root));
  const resolved = realpathNearest(resolve(absRoot, input));
  const inside = resolved === absRoot || resolved.startsWith(absRoot + sep);
  if (!inside) {
    throw new AppError('PATH_OUTSIDE_ROOT', '路径解析后越出受控根', {
      details: { root: absRoot, input },
    });
  }
  return resolved;
}
