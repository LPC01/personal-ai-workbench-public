/** Run 事件（用于 SSE 流式推送；与 persistence 的 RunEventRecord 同构）。 */
export interface RunStreamEvent {
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Run 事件的内存发布/订阅（26 SPEC §10.2 `GET /runs/{runId}/stream`）。
 * 存储层写入事件后由调用方 publish，SSE 订阅者据此推送。
 */
export class RunStreamHub {
  private readonly subscribers = new Map<string, Set<(event: RunStreamEvent) => void>>();

  /** 订阅某个 run 的事件；返回取消订阅函数。 */
  subscribe(runId: string, listener: (event: RunStreamEvent) => void): () => void {
    let set = this.subscribers.get(runId);
    if (!set) {
      set = new Set();
      this.subscribers.set(runId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.subscribers.delete(runId);
      }
    };
  }

  /** 向某个 run 的所有订阅者推送事件。 */
  publish(runId: string, event: RunStreamEvent): void {
    const set = this.subscribers.get(runId);
    if (!set) {
      return;
    }
    for (const listener of [...set]) {
      listener(event);
    }
  }
}

/**
 * 把 Run 事件格式化为 SSE 帧（`id:` 为 sequence，用于 `Last-Event-ID` 断线重连）。
 */
export function toSseFrame(event: RunStreamEvent): string {
  return `id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`;
}
