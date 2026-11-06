import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AgentProfile, AgentProfileDefinition } from '@workbench/contracts';

const PROFILE_COLUMNS = 'id, revision, definition_json, definition_hash, status, created_at';

function mapProfile(row: Record<string, unknown>): AgentProfile {
  return {
    id: row.id as string,
    revision: row.revision as number,
    definition: JSON.parse(row.definition_json as string) as AgentProfileDefinition,
    definitionHash: row.definition_hash as string,
    status: row.status as string,
    createdAt: row.created_at as string,
  };
}

function hashDefinition(definition: AgentProfileDefinition): string {
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}

/** AgentProfile 版本化存储（29 号 SPEC §8：id+revision 主键，不可变追加）。 */
export class AgentProfileStore {
  constructor(private readonly db: Database.Database) {}

  /** 版本化 upsert：definition 变化则 revision +1，否则返回现有最新版本（幂等）。 */
  upsert(input: { id: string; definition: AgentProfileDefinition; status?: string }): AgentProfile {
    const hash = hashDefinition(input.definition);
    const latest = this.get(input.id);
    if (latest && latest.definitionHash === hash) {
      return latest;
    }
    const revision = (latest?.revision ?? 0) + 1;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_profiles (id, revision, definition_json, definition_hash, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        revision,
        JSON.stringify(input.definition),
        hash,
        input.status ?? 'ACTIVE',
        now,
      );
    return this.get(input.id, revision) as AgentProfile;
  }

  /** 查询最新或指定版本。 */
  get(id: string, revision?: number): AgentProfile | undefined {
    const row = (
      revision !== undefined
        ? this.db
            .prepare(`SELECT ${PROFILE_COLUMNS} FROM agent_profiles WHERE id = ? AND revision = ?`)
            .get(id, revision)
        : this.db
            .prepare(
              `SELECT ${PROFILE_COLUMNS} FROM agent_profiles WHERE id = ? ORDER BY revision DESC LIMIT 1`,
            )
            .get(id)
    ) as Record<string, unknown> | undefined;
    return row ? mapProfile(row) : undefined;
  }

  /** 列出所有 profile 的最新版本。 */
  list(): AgentProfile[] {
    const rows = this.db
      .prepare(
        `SELECT ${PROFILE_COLUMNS} FROM agent_profiles
         WHERE (id, revision) IN (SELECT id, MAX(revision) FROM agent_profiles GROUP BY id)
         ORDER BY id`,
      )
      .all() as Record<string, unknown>[];
    return rows.map(mapProfile);
  }
}
