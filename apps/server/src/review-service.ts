import { createHash, randomUUID } from 'node:crypto';
import {
  AppError,
  aggregateBallots,
  missingRequiredEvidence,
  validateRubricWeights,
  type CandidateScore,
  type Rubric,
} from '@workbench/domain';
import type { DimensionScore, RoomDecision, RoomEvent } from '@workbench/contracts';
import type { DecisionStore, RoomStore } from '@workbench/persistence';

function sha256(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/**
 * 评审决策服务（29 号 SPEC §15）：提案/批判/证据/投票/决策。
 * Proposal/Critique/Ballot 首期作为强 Schema 的 RoomEvent（§8.2 事实源），
 * Decision 落 room_decisions 表。
 */
export class ReviewService {
  constructor(
    private readonly roomStore: RoomStore,
    private readonly decisionStore: DecisionStore,
  ) {}

  submitProposal(input: {
    roomRunId: string;
    authorId: string;
    title: string;
    summary: string;
    evidenceRefs?: string[];
  }): RoomEvent {
    const payload = {
      id: `proposal_${randomUUID()}`,
      authorId: input.authorId,
      title: input.title,
      summary: input.summary,
      evidenceRefs: input.evidenceRefs ?? [],
    };
    return this.roomStore.appendEvent({
      roomRunId: input.roomRunId,
      eventType: 'PROPOSAL_SUBMITTED',
      actorRef: input.authorId,
      payload,
      payloadHash: sha256(payload),
    });
  }

  submitCritique(input: {
    roomRunId: string;
    proposalId: string;
    authorId: string;
    dimension: string;
    comment: string;
    evidenceRefs?: string[];
  }): RoomEvent {
    const payload = {
      id: `critique_${randomUUID()}`,
      proposalId: input.proposalId,
      authorId: input.authorId,
      dimension: input.dimension,
      comment: input.comment,
      evidenceRefs: input.evidenceRefs ?? [],
    };
    return this.roomStore.appendEvent({
      roomRunId: input.roomRunId,
      eventType: 'CRITIQUE_SUBMITTED',
      actorRef: input.authorId,
      payload,
      payloadHash: sha256(payload),
    });
  }

  /** 提交评分票（§15.2：利益冲突 + 逐维证据引用校验）。 */
  submitBallot(input: {
    roomRunId: string;
    candidateId: string;
    ballotterId: string;
    proposalAuthorId: string;
    dimensionScores: DimensionScore[];
  }): RoomEvent {
    if (input.ballotterId === input.proposalAuthorId) {
      throw new AppError('BALLOT_CONFLICT_OF_INTEREST', 'Agent 不能评价自己的 Proposal', {
        details: { ballotterId: input.ballotterId, candidateId: input.candidateId },
      });
    }
    for (const score of input.dimensionScores) {
      if (score.evidenceRefs.length === 0) {
        throw new AppError('EVIDENCE_REQUIRED', `维度 ${score.dimension} 缺少证据引用`, {
          details: { dimension: score.dimension },
        });
      }
    }
    const payload = {
      id: `ballot_${randomUUID()}`,
      candidateId: input.candidateId,
      ballotterId: input.ballotterId,
      dimensionScores: input.dimensionScores,
    };
    return this.roomStore.appendEvent({
      roomRunId: input.roomRunId,
      eventType: 'BALLOT_SUBMITTED',
      actorRef: input.ballotterId,
      payload,
      payloadHash: sha256(payload),
    });
  }

  /** 从事件事实源聚合评分（§15.2 确定性加权聚合）。 */
  aggregate(roomRunId: string, rubric: Rubric, candidateIds: string[]): CandidateScore[] {
    const err = validateRubricWeights(rubric);
    if (err) {
      throw new AppError('ROOM_MANIFEST_INVALID', err, {});
    }
    const events = this.roomStore.listEvents(roomRunId);
    const ballots = events
      .filter((e) => e.eventType === 'BALLOT_SUBMITTED')
      .map((e) => ({
        ballotterId: e.payload.ballotterId as string,
        candidateId: e.payload.candidateId as string,
        scores: e.payload.dimensionScores as DimensionScore[],
      }));
    return aggregateBallots(rubric, ballots, candidateIds);
  }

  /** 记录决策（§15.2：证据 Gate + 确定性 Gate 检查）。 */
  recordDecision(input: {
    roomRunId: string;
    decisionType: string;
    winnerCandidateId: string | null;
    result: Record<string, unknown>;
    evidenceRefs?: string[];
    dissent?: Record<string, unknown>;
    requiredEvidence?: string[];
    gateChecks?: Record<string, string>;
  }): RoomDecision {
    const missing = missingRequiredEvidence(input.requiredEvidence ?? [], input.evidenceRefs ?? []);
    if (missing.length > 0) {
      throw new AppError('EVIDENCE_REQUIRED', `缺少必需证据: ${missing.join(', ')}`, {
        details: { missing },
      });
    }
    const failedGate = Object.entries(input.gateChecks ?? {}).find(([, v]) => v !== 'pass');
    if (failedGate) {
      throw new AppError('DECISION_GATE_FAILED', `Gate 未通过: ${failedGate[0]}`, {
        details: { gate: failedGate[0], status: failedGate[1] },
      });
    }
    const decision = this.decisionStore.create({
      id: `decision_${randomUUID()}`,
      roomRunId: input.roomRunId,
      decisionType: input.decisionType,
      result: { ...input.result, winnerCandidateId: input.winnerCandidateId },
      evidenceRefs: input.evidenceRefs,
      dissent: input.dissent,
      status: 'RECORDED',
    });
    this.roomStore.appendEvent({
      roomRunId: input.roomRunId,
      eventType: 'DECISION_RECORDED',
      actorRef: 'system',
      payload: {
        decisionId: decision.id,
        winnerCandidateId: input.winnerCandidateId,
      },
      payloadHash: sha256({ decisionId: decision.id }),
    });
    return decision;
  }

  listDecisions(roomRunId: string): RoomDecision[] {
    return this.decisionStore.list(roomRunId);
  }
}
