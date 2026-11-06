import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrations, openConnection, runMigrations } from '../index.js';
import { MemoryCenterStore } from '../memory-center-store.js';

const openDbs: ReturnType<typeof openConnection>[] = [];
const tmpDirs: string[] = [];

function setup(): MemoryCenterStore {
  const dir = mkdtempSync(join(tmpdir(), 'wb-memcenter-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return new MemoryCenterStore(db);
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const now = '2026-10-03T10:00:00.000Z';

describe('MemoryCenterStore（记忆中心投影）', () => {
  it('保存并读取候选记录', () => {
    const store = setup();
    store.saveCandidate({
      uri: 'mem-cand-1',
      projectId: 'proj-a',
      scope: 'project',
      content: '内容 A',
      status: 'CANDIDATE',
      sourceUri: null,
      supersededBy: null,
      createdAt: now,
      updatedAt: now,
    });
    const got = store.getCandidate('mem-cand-1');
    expect(got?.status).toBe('CANDIDATE');
    expect(got?.content).toBe('内容 A');
    expect(store.getCandidate('不存在')).toBeUndefined();
  });

  it('saveCandidate 为 upsert：二次保存刷新状态且不新增行', () => {
    const store = setup();
    const base = {
      uri: 'mem-cand-1',
      projectId: 'proj-a',
      scope: 'project' as const,
      content: '内容 A',
      sourceUri: null,
      supersededBy: null,
      createdAt: now,
      updatedAt: now,
    };
    store.saveCandidate({ ...base, status: 'CANDIDATE' });
    store.saveCandidate({ ...base, status: 'VERIFIED', updatedAt: '2026-10-03T11:00:00.000Z' });
    expect(store.listCandidates()).toHaveLength(1);
    expect(store.getCandidate('mem-cand-1')?.status).toBe('VERIFIED');
  });

  it('listCandidates 支持 projectId 与 statuses 过滤', () => {
    const store = setup();
    const mk = (uri: string, projectId: string, status: 'CANDIDATE' | 'SUPERSEDED') => ({
      uri,
      projectId,
      scope: 'project' as const,
      content: uri,
      status,
      sourceUri: null,
      supersededBy: null,
      createdAt: now,
      updatedAt: now,
    });
    store.saveCandidate(mk('c1', 'proj-a', 'CANDIDATE'));
    store.saveCandidate(mk('c2', 'proj-a', 'SUPERSEDED'));
    store.saveCandidate(mk('c3', 'proj-b', 'CANDIDATE'));

    expect(store.listCandidates({ projectId: 'proj-a' })).toHaveLength(2);
    expect(store.listCandidates({ projectId: 'proj-a', statuses: ['CANDIDATE'] })).toHaveLength(1);
    expect(store.listCandidates({ statuses: ['CANDIDATE'] })).toHaveLength(2);
  });

  it('记录并列出资源', () => {
    const store = setup();
    store.recordResource({
      uri: 'project:proj-a:intro',
      projectId: 'proj-a',
      name: 'intro',
      sensitivity: 'internal',
      sourceHash: 'hash-1',
      createdAt: now,
    });
    store.recordResource({
      uri: 'project:proj-b:intro',
      projectId: 'proj-b',
      name: 'intro',
      sensitivity: 'public',
      sourceHash: null,
      createdAt: now,
    });
    expect(store.listResources()).toHaveLength(2);
    expect(store.listResources({ projectId: 'proj-b' })).toHaveLength(1);
  });

  it('追加召回审计并支持 limit / 倒序', () => {
    const store = setup();
    const mk = (id: string, createdAt: string) => ({
      id,
      projectId: 'proj-a',
      query: `q-${id}`,
      scope: 'project' as const,
      hitUris: [`project:proj-a:${id}`],
      totalTokens: 10,
      budgetTokens: 2048,
      injectedPosition: 'context' as const,
      createdAt,
    });
    store.appendRecallAudit(mk('a1', '2026-10-03T10:00:00.000Z'));
    store.appendRecallAudit(mk('a2', '2026-10-03T11:00:00.000Z'));

    const all = store.listRecallAudits();
    expect(all).toHaveLength(2);
    expect(all[0]?.id).toBe('a2');
    expect(all[0]?.hitUris).toEqual(['project:proj-a:a2']);
    expect(store.listRecallAudits({ limit: 1 })).toHaveLength(1);
    expect(store.listRecallAudits({ projectId: 'proj-x' })).toHaveLength(0);
  });
});
