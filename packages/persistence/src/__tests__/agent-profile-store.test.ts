import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  AgentProfileStore,
  AgentSessionStore,
  migrations,
  openConnection,
  runMigrations,
} from '../index.js';

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

function setup(): {
  db: Database.Database;
  profiles: AgentProfileStore;
  sessions: AgentSessionStore;
} {
  const dir = mkdtempSync(join(tmpdir(), 'wb-ap-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return { db, profiles: new AgentProfileStore(db), sessions: new AgentSessionStore(db) };
}

/** 建 room + room_run（agent_sessions 有 FK 约束）。 */
function seedRun(db: Database.Database, runId: string): void {
  db.prepare(
    `INSERT INTO rooms (id, name, room_type, manifest_json, manifest_hash, status, created_at, updated_at)
     VALUES ('room1', 'R', 'sdd-delivery', '{}', 'h', 'DRAFT', 't', 't')`,
  ).run();
  db.prepare(
    `INSERT INTO room_runs (id, room_id, protocol_id, protocol_version, snapshot_json, budget_json, usage_json, status, created_at)
     VALUES (?, 'room1', 'sequential', '1.0', '{}', '{}', '{}', 'CREATED', 't')`,
  ).run(runId);
}

describe('AgentProfileStore 版本化（MA-03）', () => {
  it('upsert 相同定义幂等（revision 不变），变化则 revision +1', () => {
    const { profiles } = setup();
    const def = { systemInstruction: '你是设计 Agent' };
    const p1 = profiles.upsert({ id: 'designer', definition: def });
    expect(p1.revision).toBe(1);
    expect(p1.definitionHash).toBeTruthy();

    const p1b = profiles.upsert({ id: 'designer', definition: def });
    expect(p1b.revision).toBe(1); // 幂等

    const p2 = profiles.upsert({
      id: 'designer',
      definition: { systemInstruction: '你是设计 Agent（改）' },
    });
    expect(p2.revision).toBe(2);
  });

  it('get 支持指定版本，list 返回最新版本', () => {
    const { profiles } = setup();
    profiles.upsert({ id: 'designer', definition: { systemInstruction: 'v1' } });
    profiles.upsert({ id: 'designer', definition: { systemInstruction: 'v2' } });
    profiles.upsert({ id: 'builder', definition: { systemInstruction: '你是 Builder' } });

    expect(profiles.get('designer')?.revision).toBe(2);
    expect(profiles.get('designer', 1)?.definition.systemInstruction).toBe('v1');
    const list = profiles.list();
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.id === 'designer')?.revision).toBe(2);
  });
});

describe('AgentSessionStore 快照（MA-03）', () => {
  it('create 固定快照，list/游标推进', () => {
    const { db, sessions } = setup();
    seedRun(db, 'run1');
    const s = sessions.create({
      id: 'session_1',
      roomRunId: 'run1',
      participantId: 'designer',
      agentProfileSnapshot: { id: 'designer', revision: 3, definition: { systemInstruction: 'x' } },
      modelBinding: { modelProfileId: 'kimi', revision: 1 },
      toolPolicy: { allowedTools: ['project.describe'] },
    });
    expect(s.contextCursor).toBe(0);
    expect(s.modelBinding.modelProfileId).toBe('kimi');
    expect(s.toolPolicy.allowedTools).toEqual(['project.describe']);

    const advanced = sessions.updateContextCursor('session_1', 7);
    expect(advanced.contextCursor).toBe(7);

    expect(sessions.list('run1')).toHaveLength(1);
    expect(sessions.get('session_1')?.agentProfileSnapshot).toEqual({
      id: 'designer',
      revision: 3,
      definition: { systemInstruction: 'x' },
    });
  });

  it('同一 roomRun + participant 唯一约束', () => {
    const { db, sessions } = setup();
    seedRun(db, 'run1');
    const input = {
      id: 's1',
      roomRunId: 'run1',
      participantId: 'designer',
      agentProfileSnapshot: {},
      modelBinding: { modelProfileId: 'm', revision: 1 },
      toolPolicy: { allowedTools: [] },
    };
    sessions.create(input);
    expect(() => sessions.create({ ...input, id: 's2' })).toThrow(/UNIQUE/);
  });
});
