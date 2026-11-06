import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  createProjectValidator,
  type ProjectManifest,
  type ProjectValidator,
  type ValidationResult,
} from '@workbench/contracts';
import { AppError } from '@workbench/domain';
import { resolveWithinRoot } from './path-resolver.js';

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  manifestHash: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  /**
   * manifest `project.description` 的回填（PROJ-UI-01）。
   * 可选字段：老登记未填 description 时**不返回该键**，由前端自行兜底。
   */
  description?: string;
}

/** 注销项目时被级联清理的各表行数（便于审计与前端回显）。 */
export interface ProjectRemovalCascade {
  roomProjects: number;
  artifacts: number;
  runEvents: number;
  runs: number;
  commands: number;
}

export interface ProjectCatalogOptions {
  /**
   * 登记根（26 SPEC §5：`runtime.root` 解析后必须位于登记根）。
   * 未配置（undefined）时不限制，保持向后兼容。
   */
  registrationRoot?: string;
}

/**
 * 解析登记根（26 SPEC §5）：来自 `WB_PROJECTS_ROOT`。
 * 未配置或为空白 → undefined（**不限制**，向后兼容）。
 */
export function resolveRegistrationRoot(
  env: Record<string, string | undefined>,
): string | undefined {
  const value = env.WB_PROJECTS_ROOT?.trim();
  return value && value.length > 0 ? value : undefined;
}

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  manifest_hash: string;
  status: string;
  created_at: string;
  updated_at: string;
  manifest_json: string;
}

/**
 * 从 manifest JSON 快照解出 `project.description`。
 *
 * 解析失败或字段缺失一律返回 undefined —— 列表序列化不应因为一份畸形
 * manifest 而整体 500（该字段纯展示用途）。
 */
function descriptionFromManifest(manifestJson: string): string | undefined {
  try {
    const manifest = JSON.parse(manifestJson) as { project?: { description?: unknown } };
    const value = manifest.project?.description;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function mapRow(row: ProjectRow): Project {
  const description = descriptionFromManifest(row.manifest_json);
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    manifestHash: row.manifest_hash,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(description === undefined ? {} : { description }),
  };
}

/** Project Catalog：注册、查询、验证项目（26 SPEC §10.1）。 */
export class ProjectCatalog {
  private readonly validate: ProjectValidator;
  private readonly registrationRoot?: string;

  constructor(
    private readonly db: Database.Database,
    options: ProjectCatalogOptions = {},
  ) {
    this.validate = createProjectValidator();
    this.registrationRoot = options.registrationRoot;
  }

  /** 仅校验 manifest，不写库。 */
  validateManifest(manifest: unknown): ValidationResult<ProjectManifest> {
    return this.validate(manifest);
  }

  /** 校验 + 计算哈希 + 写库。重复 id 或 root_path 抛 PROJECT_ALREADY_EXISTS。 */
  register(manifest: ProjectManifest): Project {
    const result = this.validate(manifest);
    if (!result.valid) {
      throw new AppError('MANIFEST_INVALID', 'Manifest 不符合 workbench.project/v1 Schema', {
        details: { issues: result.issues },
      });
    }
    const value = result.value;

    // 登记根约束（26 SPEC §5：`runtime.root` 解析后必须位于登记根）。
    // 未配置登记根时跳过（向后兼容）。绝对路径须落在登记根内；相对路径按登记根解析，
    // 越级（`..`）或绝对路径在根外 → PATH_OUTSIDE_ROOT（403，复用 §17 错误码）。
    if (this.registrationRoot !== undefined) {
      resolveWithinRoot(this.registrationRoot, value.runtime.root);
    }

    const manifestJson = JSON.stringify(value);
    const manifestHash = createHash('sha256').update(manifestJson).digest('hex');
    const now = new Date().toISOString();

    if (this.db.prepare('SELECT id FROM projects WHERE id = ?').get(value.project.id)) {
      throw new AppError('PROJECT_ALREADY_EXISTS', '项目已存在', {
        details: { id: value.project.id },
      });
    }
    if (this.db.prepare('SELECT id FROM projects WHERE root_path = ?').get(value.runtime.root)) {
      throw new AppError('PROJECT_ALREADY_EXISTS', '根目录已被其他项目占用', {
        details: { rootPath: value.runtime.root },
      });
    }

    this.db
      .prepare(
        `INSERT INTO projects (id, name, root_path, manifest_hash, manifest_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.project.id,
        value.project.name,
        value.runtime.root,
        manifestHash,
        manifestJson,
        'registered',
        now,
        now,
      );

    return this.get(value.project.id) as Project;
  }

  list(): Project[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, root_path, manifest_hash, status, created_at, updated_at, manifest_json
         FROM projects ORDER BY created_at`,
      )
      .all() as ProjectRow[];
    return rows.map(mapRow);
  }

  get(id: string): Project | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, root_path, manifest_hash, status, created_at, updated_at, manifest_json
         FROM projects WHERE id = ?`,
      )
      .get(id) as ProjectRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /** 返回已登记项目的完整 manifest（用于运行时启动）。 */
  getManifest(id: string): ProjectManifest | undefined {
    const row = this.db.prepare('SELECT manifest_json FROM projects WHERE id = ?').get(id) as
      { manifest_json: string } | undefined;
    return row ? (JSON.parse(row.manifest_json) as ProjectManifest) : undefined;
  }

  /**
   * 注销项目：单事务按外键依赖顺序清理引用表，最后删 `projects` 行。
   *
   * 顺序由 DDL 决定 —— `project_commands` / `runs` / `artifacts` / `room_projects`
   * 均 `REFERENCES projects(id)` 且**无 `ON DELETE CASCADE`**，故直接删父行会
   * `SQLITE_CONSTRAINT_FOREIGNKEY`；`artifacts` 与 `run_events` 同时引用 `runs(id)`，
   * 因此必须在 `runs` 之前清理。
   *
   * 项目不存在时返回 `undefined`（不抛错，由调用方决定 404）。
   * **不触碰磁盘**：项目目录与 Artifact 内容文件一律保留。
   */
  remove(id: string): ProjectRemovalCascade | undefined {
    if (!this.get(id)) return undefined;

    const runInTransaction = this.db.transaction((): ProjectRemovalCascade => {
      const roomProjects = this.db
        .prepare('DELETE FROM room_projects WHERE project_id = ?')
        .run(id).changes;
      const artifacts = this.db
        .prepare('DELETE FROM artifacts WHERE project_id = ?')
        .run(id).changes;
      const runEvents = this.db
        .prepare(
          'DELETE FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)',
        )
        .run(id).changes;
      const runs = this.db.prepare('DELETE FROM runs WHERE project_id = ?').run(id).changes;
      const commands = this.db
        .prepare('DELETE FROM project_commands WHERE project_id = ?')
        .run(id).changes;
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      return { roomProjects, artifacts, runEvents, runs, commands };
    });

    return runInTransaction();
  }
}
