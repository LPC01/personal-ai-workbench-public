import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '../index.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()?.close();
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const ROOM_TABLES = [
  'agent_profiles',
  'rooms',
  'room_projects',
  'room_topics',
  'room_runs',
  'room_events',
  'agent_sessions',
  'room_work_items',
  'room_decisions',
];

describe('MA-01 多智能体 Room Schema migration', () => {
  it('创建 9 张聊天室表', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-room-'));
    tmpDirs.push(dir);
    const db = openConnection({ path: join(dir, 'test.db') });
    openDbs.push(db);
    runMigrations(db, migrations);

    const tables = new Set(
      (
        db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
      ).map((r) => r.name),
    );
    for (const t of ROOM_TABLES) {
      expect(tables.has(t), `缺表 ${t}`).toBe(true);
    }
  });

  it('room_events 有 (room_run_id, sequence) 唯一约束', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-room-'));
    tmpDirs.push(dir);
    const db = openConnection({ path: join(dir, 'test.db') });
    openDbs.push(db);
    runMigrations(db, migrations);

    db.prepare(
      `INSERT INTO rooms (id, name, room_type, manifest_json, manifest_hash, status, created_at, updated_at)
       VALUES ('r1', 'SDD 交付室', 'sdd-delivery', '{}', 'h', 'DRAFT', 't', 't')`,
    ).run();
    db.prepare(
      `INSERT INTO room_runs (id, room_id, protocol_id, protocol_version, snapshot_json, budget_json, usage_json, status, created_at)
       VALUES ('run1', 'r1', 'sequential', '1.0', '{}', '{}', '{}', 'CREATED', 't')`,
    ).run();
    db.prepare(
      `INSERT INTO room_events (room_run_id, sequence, event_type, actor_ref, visibility_json, payload_json, payload_hash, created_at)
       VALUES ('run1', 1, 'ROOM_RUN_CREATED', 'system', '{}', '{}', 'h', 't')`,
    ).run();

    expect(() =>
      db
        .prepare(
          `INSERT INTO room_events (room_run_id, sequence, event_type, actor_ref, visibility_json, payload_json, payload_hash, created_at)
           VALUES ('run1', 1, 'AGENT_MESSAGE', 'a', '{}', '{}', 'h2', 't')`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });
});
