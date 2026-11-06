import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ExtensionPermissions, ExtensionSpec } from '@workbench/contracts';

export type ExtensionVersionStatus = 'draft' | 'published' | 'installed';

export interface ExtensionRecord {
  id: string;
  name: string;
  enabledVersionId: string | null;
  createdAt: string;
}

export interface ExtensionVersionRecord {
  id: string;
  extensionId: string;
  version: string;
  packageHash: string;
  spec: ExtensionSpec;
  permissions: ExtensionPermissions;
  status: ExtensionVersionStatus;
  createdAt: string;
}

interface ExtensionRow {
  id: string;
  name: string;
  enabled_version_id: string | null;
  created_at: string;
}

interface ExtensionVersionRow {
  id: string;
  extension_id: string;
  version: string;
  package_hash: string;
  spec_json: string;
  permissions_json: string;
  status: string;
  created_at: string;
}

function mapExtension(row: ExtensionRow): ExtensionRecord {
  return {
    id: row.id,
    name: row.name,
    enabledVersionId: row.enabled_version_id,
    createdAt: row.created_at,
  };
}

function mapVersion(row: ExtensionVersionRow): ExtensionVersionRecord {
  return {
    id: row.id,
    extensionId: row.extension_id,
    version: row.version,
    packageHash: row.package_hash,
    spec: JSON.parse(row.spec_json) as ExtensionSpec,
    permissions: JSON.parse(row.permissions_json) as ExtensionPermissions,
    status: row.status as ExtensionVersionStatus,
    createdAt: row.created_at,
  };
}

const VERSION_COLUMNS =
  'id, extension_id, version, package_hash, spec_json, permissions_json, status, created_at';

/** 扩展包内容哈希（内容寻址：同内容 → 同哈希 → 同版本不可变）。 */
export function computeExtensionPackageHash(spec: ExtensionSpec): string {
  return createHash('sha256').update(JSON.stringify(spec)).digest('hex');
}

/**
 * Extension / Version / Install 存储（26 SPEC §6 + §8.2 + §10.3）。
 * 发布版本内容寻址且不可变；升级生成新版本。
 */
export class ExtensionStore {
  constructor(private readonly db: Database.Database) {}

  /** 注册扩展（不存在则新建）+ 新增版本（内容寻址，同内容幂等返回已有版本）。 */
  register(spec: ExtensionSpec, status: ExtensionVersionStatus = 'draft'): ExtensionVersionRecord {
    const extensionId = spec.extension.id;
    this.upsertExtension(extensionId, spec.extension.name);

    const packageHash = computeExtensionPackageHash(spec);
    const existing = this.db
      .prepare('SELECT id FROM extension_versions WHERE extension_id = ? AND package_hash = ?')
      .get(extensionId, packageHash) as { id: string } | undefined;
    if (existing) {
      return this.getVersion(existing.id) as ExtensionVersionRecord;
    }

    const id = `extver_${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO extension_versions (id, extension_id, version, package_hash, spec_json, permissions_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        extensionId,
        spec.extension.version,
        packageHash,
        JSON.stringify(spec),
        JSON.stringify(spec.permissions),
        status,
        now,
      );
    return this.getVersion(id) as ExtensionVersionRecord;
  }

  /** 发布版本（不可变，仅 draft→published）。 */
  publishVersion(versionId: string): ExtensionVersionRecord {
    const version = this.requireVersion(versionId);
    if (version.status !== 'draft') {
      throw new Error(`版本 ${version.version} 状态为 ${version.status}，不可发布`);
    }
    this.db
      .prepare('UPDATE extension_versions SET status = ? WHERE id = ?')
      .run('published', versionId);
    return this.getVersion(versionId) as ExtensionVersionRecord;
  }

  /** 安装版本（published→installed），若扩展无启用版本则同时启用。 */
  installVersion(versionId: string): ExtensionVersionRecord {
    const version = this.requireVersion(versionId);
    if (version.status === 'draft') {
      throw new Error(`版本 ${version.version} 未发布，不可安装`);
    }
    this.db
      .prepare('UPDATE extension_versions SET status = ? WHERE id = ?')
      .run('installed', versionId);
    const ext = this.getExtension(version.extensionId);
    if (ext && ext.enabledVersionId === null) {
      this.db
        .prepare('UPDATE extensions SET enabled_version_id = ? WHERE id = ?')
        .run(versionId, version.extensionId);
    }
    return this.getVersion(versionId) as ExtensionVersionRecord;
  }

  /** 启用指定版本。 */
  enableVersion(extensionId: string, versionId: string): ExtensionRecord {
    this.requireVersion(versionId);
    this.db
      .prepare('UPDATE extensions SET enabled_version_id = ? WHERE id = ?')
      .run(versionId, extensionId);
    return this.getExtension(extensionId) as ExtensionRecord;
  }

  /** 回滚到上一个已安装版本（26 SPEC §10.3 rollback）。 */
  rollback(extensionId: string): ExtensionRecord {
    const ext = this.getExtension(extensionId);
    if (!ext) {
      throw new Error(`扩展不存在: ${extensionId}`);
    }
    if (!ext.enabledVersionId) {
      throw new Error(`扩展 ${extensionId} 无启用版本，不可回滚`);
    }
    const versions = this.listVersions(extensionId);
    const currentIndex = versions.findIndex((v) => v.id === ext.enabledVersionId);
    // 在更早的版本中找最近一个已安装版本
    const target = versions
      .slice(0, currentIndex)
      .reverse()
      .find((v) => v.status === 'installed');
    if (!target) {
      throw new Error(`扩展 ${extensionId} 无更早的已安装版本可回滚`);
    }
    return this.enableVersion(extensionId, target.id);
  }

  getExtension(id: string): ExtensionRecord | undefined {
    const row = this.db
      .prepare('SELECT id, name, enabled_version_id, created_at FROM extensions WHERE id = ?')
      .get(id) as ExtensionRow | undefined;
    return row ? mapExtension(row) : undefined;
  }

  listExtensions(): ExtensionRecord[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, enabled_version_id, created_at FROM extensions ORDER BY created_at',
      )
      .all() as ExtensionRow[];
    return rows.map(mapExtension);
  }

  getVersion(id: string): ExtensionVersionRecord | undefined {
    const row = this.db
      .prepare(`SELECT ${VERSION_COLUMNS} FROM extension_versions WHERE id = ?`)
      .get(id) as ExtensionVersionRow | undefined;
    return row ? mapVersion(row) : undefined;
  }

  listVersions(extensionId: string): ExtensionVersionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ${VERSION_COLUMNS} FROM extension_versions WHERE extension_id = ? ORDER BY created_at`,
      )
      .all(extensionId) as ExtensionVersionRow[];
    return rows.map(mapVersion);
  }

  private upsertExtension(id: string, name: string): void {
    const existing = this.db.prepare('SELECT id FROM extensions WHERE id = ?').get(id);
    if (existing) {
      this.db.prepare('UPDATE extensions SET name = ? WHERE id = ?').run(name, id);
      return;
    }
    this.db
      .prepare('INSERT INTO extensions (id, name, created_at) VALUES (?, ?, ?)')
      .run(id, name, new Date().toISOString());
  }

  private requireVersion(versionId: string): ExtensionVersionRecord {
    const version = this.getVersion(versionId);
    if (!version) {
      throw new Error(`Extension 版本不存在: ${versionId}`);
    }
    return version;
  }
}
