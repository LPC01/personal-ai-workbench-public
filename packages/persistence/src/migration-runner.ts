import type Database from 'better-sqlite3';

export interface Migration {
  /** 单调递增的版本号，全局唯一 */
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

const MIGRATIONS_TABLE = 'schema_migrations';

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL
     );`,
  );
}

function getAppliedVersions(db: Database.Database): number[] {
  const rows = db.prepare(`SELECT version FROM ${MIGRATIONS_TABLE}`).all() as { version: number }[];
  return rows.map((r) => r.version);
}

/**
 * 应用 migration：单向编号、每个 migration 独立事务、可重复启动（幂等）。
 * 任一步失败即回滚该 migration，且不记录到 schema_migrations。
 */
export function runMigrations(db: Database.Database, migrations: Migration[]): MigrationResult {
  ensureMigrationsTable(db);
  const appliedVersions = new Set(getAppliedVersions(db));

  const ordered = [...migrations].sort((a, b) => a.version - b.version);

  const seen = new Set<number>();
  for (const m of ordered) {
    if (seen.has(m.version)) {
      throw new Error(`Duplicate migration version: ${m.version}`);
    }
    seen.add(m.version);
  }

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const m of ordered) {
    if (appliedVersions.has(m.version)) {
      skipped.push(m.name);
      continue;
    }
    const apply = db.transaction(() => {
      m.up(db);
      db.prepare(
        `INSERT INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`,
      ).run(m.version, m.name, new Date().toISOString());
    });
    apply();
    applied.push(m.name);
  }

  return { applied, skipped };
}
