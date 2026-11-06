import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { assertWithinDiskQuota } from './disk-quota.js';

export interface ArtifactRecord {
  id: string;
  runId: string;
  projectId: string | null;
  kind: string;
  logicalName: string;
  storageRef: string;
  sha256: string;
  mediaType: string | null;
  sizeBytes: number;
  createdAt: string;
}

export interface StagedArtifact {
  stagingPath: string;
  sha256: string;
  sizeBytes: number;
}

export interface CreateArtifactInput {
  id?: string;
  runId: string;
  projectId?: string;
  kind: string;
  logicalName: string;
  content: Buffer;
  mediaType?: string;
}

interface ArtifactRow {
  id: string;
  run_id: string;
  project_id: string | null;
  kind: string;
  logical_name: string;
  storage_ref: string;
  sha256: string;
  media_type: string | null;
  size_bytes: number;
  created_at: string;
}

function mapArtifactRow(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    kind: row.kind,
    logicalName: row.logical_name,
    storageRef: row.storage_ref,
    sha256: row.sha256,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

const ARTIFACT_COLUMNS =
  'id, run_id, project_id, kind, logical_name, storage_ref, sha256, media_type, size_bytes, created_at';

/**
 * Artifact 存储（26 SPEC §8.2 + §10.2）：staging → 哈希 → 原子发布 → 下载。
 * 发布失败不覆盖上一正式版本（先写库后原子 rename，失败回滚）。
 */
export class ArtifactStore {
  private readonly stagingRoot: string;

  constructor(
    private readonly db: Database.Database,
    private readonly artifactsRoot: string,
    private readonly maxTotalBytes?: number,
  ) {
    this.stagingRoot = join(artifactsRoot, '.staging');
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(this.stagingRoot, { recursive: true });
  }

  /** 将内容写入 staging 临时文件并计算 SHA-256。 */
  stage(content: Buffer): StagedArtifact {
    const sha256 = createHash('sha256').update(content).digest('hex');
    const stagingPath = join(this.stagingRoot, `.tmp-${randomUUID()}`);
    writeFileSync(stagingPath, content);
    return { stagingPath, sha256, sizeBytes: content.length };
  }

  /** 原子发布：先写库（唯一 id 主键约束防覆盖），再原子 rename staging → 最终路径；失败回滚。 */
  create(input: CreateArtifactInput): ArtifactRecord {
    const id = input.id ?? `art_${randomUUID()}`;
    // 磁盘配额检查（P8-08）：写入前校验，超限即拒绝
    assertWithinDiskQuota(this.artifactsRoot, input.content.length, this.maxTotalBytes);
    const staged = this.stage(input.content);
    const finalPath = join(this.artifactsRoot, id);
    const now = new Date().toISOString();

    // 先写库：id 冲突（主键）或 run_id 无效（外键）在此失败，文件未落盘，上一版本不受影响
    try {
      this.db
        .prepare(
          `INSERT INTO artifacts (id, run_id, project_id, kind, logical_name, storage_ref, sha256, media_type, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.runId,
          input.projectId ?? null,
          input.kind,
          input.logicalName,
          id,
          staged.sha256,
          input.mediaType ?? null,
          staged.sizeBytes,
          now,
        );
    } catch (err) {
      rmSync(staged.stagingPath, { force: true });
      throw err;
    }

    // 原子 rename（同一文件系统内原子），失败则回滚 DB 行
    try {
      renameSync(staged.stagingPath, finalPath);
    } catch (err) {
      this.db.prepare('DELETE FROM artifacts WHERE id = ?').run(id);
      rmSync(staged.stagingPath, { force: true });
      throw err;
    }

    return this.get(id) as ArtifactRecord;
  }

  get(id: string): ArtifactRecord | undefined {
    const row = this.db
      .prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE id = ?`)
      .get(id) as ArtifactRow | undefined;
    return row ? mapArtifactRow(row) : undefined;
  }

  listByRun(runId: string): ArtifactRecord[] {
    const rows = this.db
      .prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE run_id = ? ORDER BY created_at`)
      .all(runId) as ArtifactRow[];
    return rows.map(mapArtifactRow);
  }

  /** 列出全部 Artifact（用于全局摘要/时间线）。 */
  listAll(): ArtifactRecord[] {
    const rows = this.db
      .prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts ORDER BY created_at`)
      .all() as ArtifactRow[];
    return rows.map(mapArtifactRow);
  }

  /** 读取 Artifact 内容（下载）；文件缺失返回 undefined。 */
  readContent(id: string): Buffer | undefined {
    const artifact = this.get(id);
    if (!artifact) {
      return undefined;
    }
    const path = join(this.artifactsRoot, artifact.storageRef);
    if (!existsSync(path)) {
      return undefined;
    }
    return readFileSync(path);
  }
}
