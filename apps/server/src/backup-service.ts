import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import {
  BACKUP_SCHEMA_VERSION,
  type BackupFileEntry,
  type BackupManifest,
  type BackupMismatch,
  type BackupResult,
  type BackupVerification,
  type MemoryProvider,
} from '@workbench/contracts';
import type { ArtifactStore, ExtensionStore } from '@workbench/persistence';
import type { ProjectCatalog } from '@workbench/project-runtime';
import { bundleToMarkdown } from '@workbench/memory-gateway';

/** 工作台版本（与 diagnostics 保持一致）。 */
export const WORKBENCH_VERSION = '0.1.0';

const MANIFEST_NAME = 'backup-manifest.json';
const DB_NAME = 'db.sqlite';
const PROJECTS_NAME = 'projects.json';
const EXTENSIONS_NAME = 'extensions.json';
const ARTIFACTS_NAME = 'artifacts.json';
const MEMORY_NAME = 'memory.md';
const CONFIG_NAME = 'config.json';

/**
 * 备份服务（P8-04：26 SPEC §20）。
 * 备份包含 SQLite 一致性快照、Manifest、已安装扩展、Artifact 索引、Memory 导出和配置；不含明文 Credential。
 * 恢复前必须先校验哈希（verifyBackup）。
 */
export class BackupService {
  constructor(
    private readonly db: Database.Database,
    private readonly catalog: ProjectCatalog,
    private readonly extensionStore: ExtensionStore,
    private readonly artifactStore: ArtifactStore,
    private readonly memoryProvider: MemoryProvider,
  ) {}

  async createBackup(targetDir: string): Promise<BackupResult> {
    mkdirSync(targetDir, { recursive: true });
    if (readdirSync(targetDir).length > 0) {
      throw new Error(`备份目录非空: ${targetDir}`);
    }

    // 1. SQLite 一致性快照（VACUUM INTO 生成一致性副本）
    this.db.prepare('VACUUM INTO ?').run(join(targetDir, DB_NAME));

    // 2. Manifest 列表
    writeFileSync(
      join(targetDir, PROJECTS_NAME),
      JSON.stringify({ items: this.catalog.list() }, null, 2),
    );

    // 3. 已安装扩展
    writeFileSync(
      join(targetDir, EXTENSIONS_NAME),
      JSON.stringify({ items: this.extensionStore.listExtensions() }, null, 2),
    );

    // 4. Artifact 索引（不含内容）
    writeFileSync(
      join(targetDir, ARTIFACTS_NAME),
      JSON.stringify({ items: this.artifactStore.listAll() }, null, 2),
    );

    // 5. Memory 导出（Markdown 降级）
    const bundle = await this.memoryProvider.export('project');
    writeFileSync(join(targetDir, MEMORY_NAME), bundleToMarkdown(bundle));

    // 6. 配置（不含 Credential）
    writeFileSync(
      join(targetDir, CONFIG_NAME),
      JSON.stringify({ schemaVersion: BACKUP_SCHEMA_VERSION }, null, 2),
    );

    // 7. 备份清单（各文件哈希）
    const manifest = this.buildManifest(targetDir, [
      DB_NAME,
      PROJECTS_NAME,
      EXTENSIONS_NAME,
      ARTIFACTS_NAME,
      MEMORY_NAME,
      CONFIG_NAME,
    ]);
    writeFileSync(join(targetDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2));

    return { dir: targetDir, manifest };
  }

  verifyBackup(backupDir: string): BackupVerification {
    const manifestPath = join(backupDir, MANIFEST_NAME);
    if (!existsSync(manifestPath)) {
      return {
        ok: false,
        checked: 0,
        mismatches: [{ name: MANIFEST_NAME, expected: '', actual: 'missing' }],
      };
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as BackupManifest;
    const mismatches: BackupMismatch[] = [];
    for (const entry of manifest.files) {
      const path = join(backupDir, entry.name);
      if (!existsSync(path)) {
        mismatches.push({ name: entry.name, expected: entry.sha256, actual: 'missing' });
        continue;
      }
      const actual = sha256(readFileSync(path));
      if (actual !== entry.sha256) {
        mismatches.push({ name: entry.name, expected: entry.sha256, actual });
      }
    }
    return { ok: mismatches.length === 0, checked: manifest.files.length, mismatches };
  }

  private buildManifest(dir: string, names: string[]): BackupManifest {
    const files: BackupFileEntry[] = names.map((name) => {
      const buf = readFileSync(join(dir, name));
      return { name, sha256: sha256(buf), sizeBytes: buf.length };
    });
    return {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      version: WORKBENCH_VERSION,
      createdAt: new Date().toISOString(),
      files,
    };
  }
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
