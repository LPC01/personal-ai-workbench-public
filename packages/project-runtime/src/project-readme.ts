import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { resolveWithinRoot } from './path-resolver.js';

/**
 * 项目自述文件的候选文件名（按优先级）。
 *
 * 大小写变体是必要的：Windows 文件系统大小写不敏感，`README.md` 与 `readme.md`
 * 命中同一文件，但 Linux / macOS 上不同；`.markdown` / `.txt` 是社区常见退化写法。
 */
export const README_CANDIDATES: readonly string[] = [
  'README.md',
  'readme.md',
  'Readme.md',
  'README.markdown',
  'readme.markdown',
  'README.txt',
  'readme.txt',
];

/** 单文件内容上限：超出即截断，避免大仓库的自述把响应撑爆。 */
export const README_MAX_BYTES = 256 * 1024;

export interface ReadmeProbe {
  found: boolean;
  fileName?: string;
  sizeBytes?: number;
}

export interface ReadmeResult extends ReadmeProbe {
  /** 仅在 `withContent` 为真时返回。 */
  content?: string;
  /** 内容被 `README_MAX_BYTES` 截断。 */
  truncated?: boolean;
  /** 命中文件存在但读取失败（权限等）时的说明，不抛 500。 */
  error?: string;
}

export interface ReadmeReadOptions {
  /** 是否读取正文。false 用于列表页批量探测（只回元信息，零正文传输）。 */
  withContent?: boolean;
  maxBytes?: number;
}

/**
 * 在项目登记根内探测并读取自述文件（PROJ-UI-01，规范外扩展）。
 *
 * 安全（26 SPEC §16 / SEC-01）：候选名一律经 `resolveWithinRoot(rootPath, name)`
 * 解析，符号链接指向根外时该候选被跳过而非读取——与 executable 白名单同一道闸门。
 * 只读登记根**顶层**的候选文件，不下钻子目录。
 *
 * 未找到不是错误：返回 `{ found: false }`，由前端渲染明确空态。
 */
export function readProjectReadme(rootPath: string, options: ReadmeReadOptions = {}): ReadmeResult {
  const withContent = options.withContent !== false;
  const maxBytes = options.maxBytes ?? README_MAX_BYTES;

  for (const candidate of README_CANDIDATES) {
    let target: string;
    try {
      target = resolveWithinRoot(rootPath, candidate);
    } catch {
      // 解析越出受控根（符号链接逃逸）：视为未命中，不泄露路径细节
      continue;
    }

    let sizeBytes: number;
    try {
      const stat = statSync(target);
      if (!stat.isFile()) continue;
      sizeBytes = stat.size;
    } catch {
      continue;
    }

    const probe: ReadmeProbe = { found: true, fileName: candidate, sizeBytes };
    if (!withContent) return probe;

    try {
      const handle = openSync(target, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(maxBytes, sizeBytes));
        const read = readSync(handle, buffer, 0, buffer.length, 0);
        return {
          ...probe,
          content: buffer.subarray(0, read).toString('utf8'),
          truncated: sizeBytes > read,
        };
      } finally {
        closeSync(handle);
      }
    } catch (error) {
      return { ...probe, error: `读取失败：${(error as Error).message}` };
    }
  }

  return { found: false };
}
