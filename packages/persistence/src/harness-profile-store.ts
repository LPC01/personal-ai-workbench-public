import type Database from 'better-sqlite3';
import type { HarnessAdapterType, HarnessProfile, HarnessProfileInput } from '@workbench/contracts';

interface HarnessProfileRow {
  id: string;
  name: string;
  adapter_type: string;
  config_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapHarnessProfile(row: HarnessProfileRow): HarnessProfile {
  return {
    id: row.id,
    name: row.name,
    adapterType: row.adapter_type as HarnessAdapterType,
    config: JSON.parse(row.config_json) as Record<string, unknown>,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = `SELECT id, name, adapter_type, config_json, revision, created_at, updated_at FROM harness_profiles`;

/** Harness Profile 存储（26 SPEC §13 + 设计 §6.9）：upsert 时修订号 +1。 */
export class HarnessProfileStore {
  constructor(private readonly db: Database.Database) {}

  upsert(input: HarnessProfileInput): HarnessProfile {
    const existing = this.db
      .prepare('SELECT revision FROM harness_profiles WHERE id = ?')
      .get(input.id) as { revision: number } | undefined;
    const revision = (existing?.revision ?? 0) + 1;
    const now = new Date().toISOString();
    const config = JSON.stringify(input.config ?? {});
    if (existing) {
      this.db
        .prepare(
          'UPDATE harness_profiles SET name = ?, adapter_type = ?, config_json = ?, revision = ?, updated_at = ? WHERE id = ?',
        )
        .run(input.name, input.adapterType, config, revision, now, input.id);
    } else {
      this.db
        .prepare(
          `INSERT INTO harness_profiles (id, name, adapter_type, config_json, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.id, input.name, input.adapterType, config, revision, now, now);
    }
    return this.get(input.id) as HarnessProfile;
  }

  list(): HarnessProfile[] {
    const rows = this.db.prepare(`${SELECT} ORDER BY id`).all() as HarnessProfileRow[];
    return rows.map(mapHarnessProfile);
  }

  get(id: string): HarnessProfile | undefined {
    const row = this.db.prepare(`${SELECT} WHERE id = ?`).get(id) as HarnessProfileRow | undefined;
    return row ? mapHarnessProfile(row) : undefined;
  }
}
