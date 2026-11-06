/**
 * 评审决策纯逻辑（29 号 SPEC §15 提案/评审/投票/裁决）。
 * domain 包保持纯净，不依赖 contracts；类型与 contracts 结构兼容。
 */

/** Rubric 维度（权重 0-100，总权重必须 100）。 */
export interface RubricDimension {
  key: string;
  name: string;
  weight: number;
}

export interface Rubric {
  dimensions: RubricDimension[];
}

/** 默认 Rubric（§15.2）：需求覆盖 25 / 技术可行性 20 / 证据 20 / 复杂度 15 / 可维护性 10 / 风险安全 10。 */
export const DEFAULT_RUBRIC: Rubric = {
  dimensions: [
    { key: 'requirement', name: '需求覆盖', weight: 25 },
    { key: 'feasibility', name: '技术可行性', weight: 20 },
    { key: 'evidence', name: '证据', weight: 20 },
    { key: 'complexity', name: '实现复杂度', weight: 15 },
    { key: 'maintainability', name: '可维护性', weight: 10 },
    { key: 'risk', name: '风险安全', weight: 10 },
  ],
};

/** 校验 Rubric 总权重（§15.2：必须为 100）。返回错误信息或 null。 */
export function validateRubricWeights(rubric: Rubric): string | null {
  const total = rubric.dimensions.reduce((sum, d) => sum + d.weight, 0);
  return total === 100 ? null : `Rubric 总权重必须为 100，当前 ${total}`;
}

/** 单维度评分（必须带证据引用，§15.2 禁止只给总分）。 */
export interface DimensionScore {
  dimension: string;
  score: number;
  evidenceRefs: string[];
}

/** 一张匿名候选的评分票。 */
export interface Ballot {
  ballotterId: string;
  candidateId: string;
  scores: DimensionScore[];
}

/** 聚合后的候选得分。 */
export interface CandidateScore {
  candidateId: string;
  totalScore: number;
  dimensionScores: Record<string, number>;
  evidenceCount: number;
}

/** 确定性加权聚合（§15.2：逐维加权平均，禁止只给总分）。 */
export function aggregateBallots(
  rubric: Rubric,
  ballots: Ballot[],
  candidateIds: string[],
): CandidateScore[] {
  return candidateIds.map((candidateId) => {
    const candidateBallots = ballots.filter((b) => b.candidateId === candidateId);
    const dimensionScores: Record<string, number> = {};
    let totalScore = 0;
    for (const dim of rubric.dimensions) {
      const weight = dim.weight / 100;
      const scores = candidateBallots
        .map((b) => b.scores.find((s) => s.dimension === dim.key))
        .filter((s): s is DimensionScore => s !== undefined);
      const avg =
        scores.length > 0 ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length : 0;
      dimensionScores[dim.key] = avg;
      totalScore += avg * weight;
    }
    const evidenceCount = candidateBallots.reduce(
      (sum, b) => sum + b.scores.reduce((s2, x) => s2 + x.evidenceRefs.length, 0),
      0,
    );
    return { candidateId, totalScore, dimensionScores, evidenceCount };
  });
}

/** 利益冲突检测（§15.2：Agent 禁止评价自己的 Proposal）。 */
export function hasConflictOfInterest(
  ballot: Ballot,
  candidateAuthors: Record<string, string>,
): boolean {
  const author = candidateAuthors[ballot.candidateId];
  return author !== undefined && author === ballot.ballotterId;
}

/** 证据完整性：返回缺失的必需证据（§15.2：缺少必需证据 → INELIGIBLE）。 */
export function missingRequiredEvidence(
  requiredEvidence: string[],
  providedEvidence: string[],
): string[] {
  return requiredEvidence.filter((r) => !providedEvidence.includes(r));
}

/** 候选附加属性（用于平票决胜）。 */
export interface CandidateTiebreak {
  risk: number;
  complexity: number;
}

/**
 * 平票处理（§15.2）：按证据完整度(降序)、风险(升序)、复杂度(升序)固定次序，
 * 仍相同保持并列（返回原相对顺序）。`extra` 缺省视为 0。
 */
export function tieBreak(
  tied: CandidateScore[],
  extra: Record<string, CandidateTiebreak>,
): CandidateScore[] {
  return [...tied].sort((a, b) => {
    if (a.evidenceCount !== b.evidenceCount) return b.evidenceCount - a.evidenceCount;
    const riskA = extra[a.candidateId]?.risk ?? 0;
    const riskB = extra[b.candidateId]?.risk ?? 0;
    if (riskA !== riskB) return riskA - riskB;
    const complexityA = extra[a.candidateId]?.complexity ?? 0;
    const complexityB = extra[b.candidateId]?.complexity ?? 0;
    return complexityA - complexityB;
  });
}
