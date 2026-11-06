import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUBRIC,
  aggregateBallots,
  hasConflictOfInterest,
  missingRequiredEvidence,
  tieBreak,
  validateRubricWeights,
  type Ballot,
} from '../review.js';

describe('validateRubricWeights（§15.2 总权重 100）', () => {
  it('默认 Rubric 权重合法', () => {
    expect(validateRubricWeights(DEFAULT_RUBRIC)).toBeNull();
  });

  it('权重非 100 报错', () => {
    expect(
      validateRubricWeights({
        dimensions: [
          { key: 'a', name: 'A', weight: 60 },
          { key: 'b', name: 'B', weight: 30 },
        ],
      }),
    ).toMatch(/总权重必须为 100/);
  });
});

describe('aggregateBallots（§15.2 确定性加权聚合）', () => {
  const candidates = ['c1', 'c2'];
  const ballotForC1: Ballot = {
    ballotterId: 'reviewer',
    candidateId: 'c1',
    scores: [
      { dimension: 'requirement', score: 10, evidenceRefs: ['e1'] },
      { dimension: 'feasibility', score: 8, evidenceRefs: ['e2'] },
    ],
  };
  const ballotForC2: Ballot = {
    ballotterId: 'reviewer',
    candidateId: 'c2',
    scores: [{ dimension: 'requirement', score: 4, evidenceRefs: ['e3'] }],
  };

  it('加权聚合：分数 = Σ(维度均分 × 权重)', () => {
    const [c1] = aggregateBallots(DEFAULT_RUBRIC, [ballotForC1], candidates);
    // requirement 25% × 10 + feasibility 20% × 8 = 2.5 + 1.6 = 4.1
    expect(c1?.candidateId).toBe('c1');
    expect(c1?.totalScore).toBeCloseTo(4.1);
    expect(c1?.evidenceCount).toBe(2);
  });

  it('缺维度按 0 计，得分反映证据差异', () => {
    const [c1, c2] = aggregateBallots(DEFAULT_RUBRIC, [ballotForC1, ballotForC2], candidates);
    expect(c1?.totalScore).toBeGreaterThan(c2?.totalScore ?? 0);
  });
});

describe('hasConflictOfInterest（§15.2 禁止评价自己的候选）', () => {
  it('评自己的候选冲突，评别人的不冲突', () => {
    const ballot: Ballot = {
      ballotterId: 'designer',
      candidateId: 'c1',
      scores: [{ dimension: 'requirement', score: 8, evidenceRefs: ['e'] }],
    };
    expect(hasConflictOfInterest(ballot, { c1: 'designer' })).toBe(true);
    expect(hasConflictOfInterest(ballot, { c1: 'builder' })).toBe(false);
  });
});

describe('missingRequiredEvidence（§15.2 证据完整性）', () => {
  it('返回缺失的必需证据', () => {
    expect(missingRequiredEvidence(['tests', 'lint'], ['tests'])).toEqual(['lint']);
    expect(missingRequiredEvidence(['tests'], ['tests', 'lint'])).toEqual([]);
  });
});

describe('tieBreak（§15.2 平票决胜）', () => {
  it('按证据完整度降序、风险升序、复杂度升序', () => {
    const tied = [
      { candidateId: 'a', totalScore: 5, dimensionScores: {}, evidenceCount: 2 },
      { candidateId: 'b', totalScore: 5, dimensionScores: {}, evidenceCount: 2 },
      { candidateId: 'c', totalScore: 5, dimensionScores: {}, evidenceCount: 3 },
    ];
    const extra = {
      a: { risk: 1, complexity: 5 },
      b: { risk: 2, complexity: 1 },
      c: { risk: 3, complexity: 3 },
    };
    const ordered = tieBreak(tied, extra);
    expect(ordered[0]?.candidateId).toBe('c'); // 证据最多
    expect(ordered[1]?.candidateId).toBe('a'); // 风险低
    expect(ordered[2]?.candidateId).toBe('b');
  });
});
