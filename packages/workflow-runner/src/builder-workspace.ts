import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { AppError } from '@workbench/domain';

/**
 * Builder 隔离临时工作区（26 SPEC §16 SEC-002/SEC-005 + 设计 §6.6）。
 *
 * - 在系统临时目录下创建隔离工作区；
 * - 所有路径解析后必须处于工作区根内（路径穿越防护）；
 * - 与 Host 分离，独立数据目录（不读取生产凭据）。
 */
export class BuilderWorkspace {
  readonly root: string;
  private cleaned = false;

  constructor(root?: string) {
    this.root = root ?? mkdtempSync(join(tmpdir(), `wb-builder-`));
    mkdirSync(this.root, { recursive: true });
  }

  /** 解析相对路径到工作区根内；越界抛 `PATH_OUTSIDE_ROOT`（SEC-002）。 */
  resolve(relPath: string): string {
    const abs = resolve(this.root, relPath);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) {
      throw new AppError('PATH_OUTSIDE_ROOT', '路径越出 Builder 工作区', {
        details: { relPath },
      });
    }
    return abs;
  }

  writeFile(relPath: string, content: string): void {
    this.assertActive();
    const abs = this.resolve(relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }

  readFile(relPath: string): string {
    this.assertActive();
    const abs = this.resolve(relPath);
    return readFileSync(abs, 'utf8');
  }

  exists(relPath: string): boolean {
    return existsSync(this.resolve(relPath));
  }

  /** 清理临时工作区。 */
  cleanup(): void {
    if (this.cleaned) {
      return;
    }
    rmSync(this.root, { recursive: true, force: true });
    this.cleaned = true;
  }

  private assertActive(): void {
    if (this.cleaned) {
      throw new Error('Builder 工作区已清理');
    }
  }
}

/** 便捷构造：用给定随机后缀创建唯一工作区。 */
export function createBuilderWorkspace(): BuilderWorkspace {
  return new BuilderWorkspace(join(tmpdir(), `wb-builder-${randomUUID()}`));
}
