import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';
import { DEFAULT_RUBRIC } from '@workbench/domain';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function setup(): { app: ReturnType<typeof buildApp> } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-review-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return { app: buildApp(db) };
}

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()?.close();
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function seedRun(app: ReturnType<typeof buildApp>): Promise<string> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    payload: { name: 'R', roomType: 'review', manifest: { id: 'room_x' } },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/rooms/room_x/runs',
    payload: { protocolId: 'review', protocolVersion: '1.0' },
  });
  return (res.json() as { id: string }).id;
}

describe('评审决策 API（MA-05）', () => {
  it('提交提案 → PROPOSAL_SUBMITTED 事件', async () => {
    const { app } = setup();
    const runId = await seedRun(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/proposals`,
      payload: { authorId: 'designer', title: '方案 A', summary: '设计' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { eventType: string }).eventType).toBe('PROPOSAL_SUBMITTED');
  });

  it('自己评自己的候选 → 422 BALLOT_CONFLICT_OF_INTEREST', async () => {
    const { app } = setup();
    const runId = await seedRun(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/ballots`,
      payload: {
        candidateId: 'c1',
        ballotterId: 'designer',
        proposalAuthorId: 'designer',
        dimensionScores: [{ dimension: 'requirement', score: 9, evidenceRefs: ['e'] }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'BALLOT_CONFLICT_OF_INTEREST',
    );
  });

  it('投票缺证据引用 → 422 EVIDENCE_REQUIRED', async () => {
    const { app } = setup();
    const runId = await seedRun(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/ballots`,
      payload: {
        candidateId: 'c1',
        ballotterId: 'reviewer',
        proposalAuthorId: 'designer',
        dimensionScores: [{ dimension: 'requirement', score: 9, evidenceRefs: [] }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe('EVIDENCE_REQUIRED');
  });

  it('聚合评分：加权聚合返回排序结果', async () => {
    const { app } = setup();
    const runId = await seedRun(app);
    await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/ballots`,
      payload: {
        candidateId: 'c1',
        ballotterId: 'reviewer',
        proposalAuthorId: 'designer',
        dimensionScores: [
          { dimension: 'requirement', score: 10, evidenceRefs: ['e1'] },
          { dimension: 'feasibility', score: 8, evidenceRefs: ['e2'] },
        ],
      },
    });
    const agg = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/aggregate`,
      payload: { rubric: DEFAULT_RUBRIC, candidateIds: ['c1'] },
    });
    expect(agg.statusCode).toBe(200);
    const items = agg.json() as { candidateId: string; totalScore: number }[];
    expect(items[0]?.candidateId).toBe('c1');
    expect(items[0]?.totalScore).toBeCloseTo(4.1);
  });

  it('记录决策缺必需证据 → 422 EVIDENCE_REQUIRED', async () => {
    const { app } = setup();
    const runId = await seedRun(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/decisions`,
      payload: {
        decisionType: 'select',
        winnerCandidateId: 'c1',
        result: {},
        evidenceRefs: [],
        requiredEvidence: ['tests pass'],
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe('EVIDENCE_REQUIRED');
  });

  it('Gate 未通过 → 409 DECISION_GATE_FAILED', async () => {
    const { app } = setup();
    const runId = await seedRun(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/decisions`,
      payload: {
        decisionType: 'select',
        winnerCandidateId: 'c1',
        result: {},
        evidenceRefs: ['tests pass'],
        requiredEvidence: ['tests pass'],
        gateChecks: { tests: 'fail' },
      },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('DECISION_GATE_FAILED');
  });

  it('记录决策成功 → DECISION_RECORDED 事件 + decisions 列表', async () => {
    const { app } = setup();
    const runId = await seedRun(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/room-runs/${runId}/decisions`,
      payload: {
        decisionType: 'select',
        winnerCandidateId: 'c1',
        result: { summary: '选定方案 A' },
        evidenceRefs: ['tests pass'],
        requiredEvidence: ['tests pass'],
        gateChecks: { tests: 'pass' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('RECORDED');

    const list = await app.inject({ method: 'GET', url: `/api/v1/room-runs/${runId}/decisions` });
    expect((list.json() as { total: number }).total).toBe(1);
  });
});
