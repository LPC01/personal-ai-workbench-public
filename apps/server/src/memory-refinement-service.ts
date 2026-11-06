import {
  AppError,
  scrubSecrets,
  validateCandidateSource,
  type CandidateSource,
} from '@workbench/domain';
import type { RoomEvent } from '@workbench/contracts';
import type { RoomStore } from '@workbench/persistence';

/**
 * 记忆提炼服务（29 号 SPEC §17 记忆与问题闭环）。
 * 提炼 Candidate Memory：Secret/PII 脱敏 + 来源验证（RoomRun/Event/Artifact/Decision）。
 * Issue → Lesson 闭环由 IssueService.promoteToLesson 承接。
 */
export class MemoryRefinementService {
  constructor(private readonly roomStore: RoomStore) {}

  /** 提炼 Candidate Memory（§17：脱敏 + 来源验证 + 追加 MEMORY_CANDIDATE_CREATED 事件）。 */
  refineToCandidate(input: { roomRunId: string; content: string; source: CandidateSource }): {
    cleaned: string;
    redacted: string[];
    source: CandidateSource;
    event: RoomEvent;
  } {
    const srcErr = validateCandidateSource(input.source);
    if (srcErr) {
      throw new AppError('EVIDENCE_REQUIRED', srcErr, {
        details: input.source as unknown as Record<string, unknown>,
      });
    }
    const { cleaned, redacted } = scrubSecrets(input.content);
    const event = this.roomStore.appendEvent({
      roomRunId: input.roomRunId,
      eventType: 'MEMORY_CANDIDATE_CREATED',
      actorRef: 'system',
      payload: { cleaned, redacted, source: input.source as unknown as Record<string, unknown> },
    });
    return { cleaned, redacted, source: input.source, event };
  }
}
