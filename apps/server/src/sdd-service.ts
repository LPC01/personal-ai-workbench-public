import { randomUUID } from 'node:crypto';
import { AppError, advanceSddStage, type SddGateContext, type SddStage } from '@workbench/domain';
import type { RoomRun } from '@workbench/contracts';
import type { RoomStore } from '@workbench/persistence';

/**
 * SDD 开发交付服务（29 号 SPEC §14）：`sdd-delivery/v1` 固定 9 阶段 + 门禁。
 * 阶段状态存 RoomRun.snapshot.stage，推进追加 SDD_STAGE_ADVANCED 事件（事实源）。
 */
export class SddService {
  constructor(private readonly roomStore: RoomStore) {}

  /** 创建 SDD 交付 Run，初始阶段 INTAKE。 */
  createSddRun(input: { roomId: string; topicId?: string }): RoomRun {
    return this.roomStore.createRun({
      id: `roomrun_${randomUUID()}`,
      roomId: input.roomId,
      topicId: input.topicId,
      protocolId: 'sdd-delivery',
      protocolVersion: '1.0',
      snapshot: { stage: 'INTAKE' },
    });
  }

  getStage(roomRunId: string): SddStage {
    return ((this.getRunOrThrow(roomRunId).snapshot.stage as SddStage) ?? 'INTAKE') as SddStage;
  }

  /** 推进阶段（§14 门禁校验 + 快照更新 + 事件追加）。 */
  advanceStage(roomRunId: string, ctx: SddGateContext): { stage: SddStage } {
    const run = this.getRunOrThrow(roomRunId);
    const stage = (run.snapshot.stage as SddStage) ?? 'INTAKE';
    const result = advanceSddStage(stage, ctx);
    if ('error' in result) {
      throw new AppError('ROOM_RUN_STATE_CONFLICT', result.error, { details: { stage } });
    }
    const next = result.next;
    this.roomStore.updateRunSnapshot(roomRunId, { ...run.snapshot, stage: next });
    this.roomStore.appendEvent({
      roomRunId,
      eventType: 'SDD_STAGE_ADVANCED',
      actorRef: 'system',
      payload: { from: stage, to: next },
    });
    return { stage: next };
  }

  private getRunOrThrow(roomRunId: string): RoomRun {
    const run = this.roomStore.getRun(roomRunId);
    if (!run) {
      throw new AppError('ROOM_RUN_NOT_FOUND', 'RoomRun 不存在', { details: { roomRunId } });
    }
    return run;
  }
}
