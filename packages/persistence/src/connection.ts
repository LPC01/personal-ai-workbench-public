import Database from 'better-sqlite3';

export interface OpenOptions {
  /** SQLite 文件路径，或 `:memory:` */
  path: string;
  /** busy timeout 毫秒，默认 5000 */
  busyTimeoutMs?: number;
}

/**
 * 打开 SQLite 连接并启用 SPEC §3 要求的 WAL、foreign keys、busy timeout。
 */
export function openConnection(options: OpenOptions): Database.Database {
  const db = new Database(options.path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
  return db;
}
