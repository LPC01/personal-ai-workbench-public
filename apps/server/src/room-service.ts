import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  AppError,
  assertRoomRunTransition,
  canTransitionRoomRun,
  isTerminalRunStatus,
  resolveCancelStatus,
} from '@workbench/domain';
import type { Room, RoomEvent, RoomRun, RoomRunStatus, RoomTopic } from '@workbench/contracts';
import type { RoomStore, RunStore } from '@workbench/persistence';

function sha256(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/**
 * 聊天室服务（29 号 SPEC §11）：Room/Topic/Message/Run 与事件追加。
 * 编排与发言调度属 MA-04；本服务仅提供受理与事件事实源。
 */
export class RoomService {
  constructor(
    private readonly store: RoomStore,
    private readonly runStore: RunStore,
  ) {}

  createRoom(input: { name: string; roomType: string; manifest: Record<string, unknown> }): Room {
    const id = (input.manifest.id as string | undefined) ?? `room_${randomUUID()}`;
    const manifestHash = sha256(input.manifest);
    return this.store.createRoom({
      id,
      name: input.name,
      roomType: input.roomType,
      manifest: input.manifest,
      manifestHash,
    });
  }

  listRooms(): Room[] {
    return this.store.listRooms();
  }

  getRoom(id: string): Room {
    const room = this.store.getRoom(id);
    if (!room) {
      throw new AppError('ROOM_NOT_FOUND', '聊天室不存在', { details: { id } });
    }
    return room;
  }

  activate(id: string): Room {
    return this.store.updateRoomStatus(id, 'ACTIVE');
  }

  archive(id: string): Room {
    return this.store.updateRoomStatus(id, 'ARCHIVED');
  }

  createTopic(input: { roomId: string; title: string }): RoomTopic {
    return this.store.createTopic({
      id: `topic_${randomUUID()}`,
      roomId: input.roomId,
      title: input.title,
    });
  }

  /** 创建 RoomRun 并追加 ROOM_RUN_CREATED 事件。 */
  createRun(input: {
    roomId: string;
    topicId?: string;
    protocolId: string;
    protocolVersion: string;
    snapshot?: Record<string, unknown>;
    budget?: Record<string, unknown>;
  }): RoomRun {
    this.getRoom(input.roomId);
    const run = this.store.createRun({
      id: `roomrun_${randomUUID()}`,
      roomId: input.roomId,
      topicId: input.topicId,
      protocolId: input.protocolId,
      protocolVersion: input.protocolVersion,
      snapshot: input.snapshot,
      budget: input.budget,
    });
    this.store.appendEvent({
      roomRunId: run.id,
      eventType: 'ROOM_RUN_CREATED',
      actorRef: 'system',
      payload: { roomId: input.roomId, protocolId: input.protocolId },
      payloadHash: sha256({ roomId: input.roomId, protocolId: input.protocolId }),
    });
    return run;
  }

  /** 追加用户消息事件（§11：仅创建 UserMessage，不触发 Shell）。 */
  postMessage(input: { roomRunId: string; actorRef: string; content: string }): RoomEvent {
    const payload = { content: input.content };
    return this.store.appendEvent({
      roomRunId: input.roomRunId,
      eventType: 'USER_MESSAGE',
      actorRef: input.actorRef,
      payload,
      payloadHash: sha256(payload),
    });
  }

  listEvents(roomRunId: string): RoomEvent[] {
    return this.store.listEvents(roomRunId);
  }

  listEventsAfter(roomRunId: string, afterSequence: number): RoomEvent[] {
    return this.store.listEventsAfter(roomRunId, afterSequence);
  }

  getRun(roomRunId: string): RoomRun | undefined {
    return this.store.getRun(roomRunId);
  }

  private getRunOrThrow(roomRunId: string): RoomRun {
    const run = this.store.getRun(roomRunId);
    if (!run) {
      throw new AppError('ROOM_RUN_NOT_FOUND', 'RoomRun 不存在', { details: { roomRunId } });
    }
    return run;
  }

  /** 暂停（§9.2：RUNNING → PAUSED）。 */
  pause(roomRunId: string): RoomRun {
    const run = this.getRunOrThrow(roomRunId);
    this.assertTransition(run.status, 'PAUSED');
    const updated = this.store.updateRunStatus(roomRunId, 'PAUSED');
    this.store.appendEvent({
      roomRunId,
      eventType: 'ROOM_RUN_PAUSED',
      actorRef: 'system',
    });
    return updated;
  }

  /** 恢复（§9.2：PAUSED → RUNNING）。 */
  resume(roomRunId: string): RoomRun {
    const run = this.getRunOrThrow(roomRunId);
    this.assertTransition(run.status, 'RUNNING');
    const updated = this.store.updateRunStatus(roomRunId, 'RUNNING');
    this.store.appendEvent({
      roomRunId,
      eventType: 'ROOM_RUN_RESUMED',
      actorRef: 'system',
    });
    return updated;
  }

  /**
   * 取消（§9.2）：RUNNING → CANCELLING（异步传播到子 Run 后 → CANCELLED），
   * 其余可取消状态直接 → CANCELLED。
   * §19 ROOM-SEC-007：向本 RoomRun 创建的所有子 Run 传播取消（只终止本 Run 进程树）。
   */
  cancel(roomRunId: string): RoomRun {
    const run = this.getRunOrThrow(roomRunId);
    let updated: RoomRun;
    if (canTransitionRoomRun(run.status, 'CANCELLING')) {
      updated = this.store.updateRunStatus(roomRunId, 'CANCELLING');
    } else if (canTransitionRoomRun(run.status, 'CANCELLED')) {
      updated = this.store.updateRunStatus(roomRunId, 'CANCELLED');
    } else {
      throw new AppError('ROOM_RUN_STATE_CONFLICT', `状态 ${run.status} 不允许取消`, {
        details: { roomRunId, status: run.status },
      });
    }
    this.propagateCancelToChildRuns(roomRunId);
    return updated;
  }

  /** 向子 Run 传播取消（ROOM-SEC-007：只能终止本 RoomRun 创建的进程树）。 */
  private propagateCancelToChildRuns(roomRunId: string): void {
    for (const child of this.runStore.listRunsByRoomRunId(roomRunId)) {
      if (isTerminalRunStatus(child.status)) continue;
      const target = resolveCancelStatus(child.status);
      if (target) {
        this.runStore.transitionRun(child.id, target);
      }
    }
  }

  private assertTransition(from: RoomRunStatus, to: RoomRunStatus): void {
    try {
      assertRoomRunTransition(from, to);
    } catch {
      throw new AppError('ROOM_RUN_STATE_CONFLICT', `状态 ${from} 不允许转换到 ${to}`, {
        details: { from, to },
      });
    }
  }

  listWorkItems(roomRunId: string): import('@workbench/contracts').RoomWorkItem[] {
    return this.store.listWorkItems(roomRunId);
  }
}
