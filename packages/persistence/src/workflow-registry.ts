import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { computeWorkflowHash } from '@workbench/contracts';
import type { WorkflowDefinition } from '@workbench/contracts';

export interface WorkflowRecord {
  id: string;
  definitionId: string;
  version: string;
  contentHash: string;
  definition: WorkflowDefinition;
  createdAt: string;
}

interface WorkflowRow {
  id: string;
  definition_id: string;
  version: string;
  content_hash: string;
  definition_json: string;
  created_at: string;
}

function mapRow(row: WorkflowRow): WorkflowRecord {
  return {
    id: row.id,
    definitionId: row.definition_id,
    version: row.version,
    contentHash: row.content_hash,
    definition: JSON.parse(row.definition_json) as WorkflowDefinition,
    createdAt: row.created_at,
  };
}

const COLUMNS = 'id, definition_id, version, content_hash, definition_json, created_at';

/**
 * Workflow 注册表（26 SPEC §7）：内容寻址（同内容哈希幂等）。
 * Run 创建时保存定义哈希；恢复执行不得读取已变化的工作区草稿。
 */
export class WorkflowRegistry {
  constructor(private readonly db: Database.Database) {}

  /** 注册定义（内容寻址：同内容哈希幂等返回已有记录）。 */
  register(definition: WorkflowDefinition): WorkflowRecord {
    const contentHash = computeWorkflowHash(definition);
    const existing = this.db
      .prepare('SELECT id FROM workflows WHERE content_hash = ?')
      .get(contentHash) as { id: string } | undefined;
    if (existing) {
      return this.get(existing.id) as WorkflowRecord;
    }

    const id = `wf_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO workflows (id, definition_id, version, content_hash, definition_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        definition.id,
        definition.version,
        contentHash,
        JSON.stringify(definition),
        new Date().toISOString(),
      );
    return this.get(id) as WorkflowRecord;
  }

  get(id: string): WorkflowRecord | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM workflows WHERE id = ?`).get(id) as
      WorkflowRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /** 按定义 ID + 版本查询（用于 Run 绑定稳定定义）。 */
  getByDefinition(definitionId: string, version: string): WorkflowRecord | undefined {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM workflows WHERE definition_id = ? AND version = ?`)
      .get(definitionId, version) as WorkflowRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  list(): WorkflowRecord[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM workflows ORDER BY created_at`)
      .all() as WorkflowRow[];
    return rows.map(mapRow);
  }
}
