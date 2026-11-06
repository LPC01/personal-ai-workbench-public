import { useEffect, useRef } from 'react';
import type { RoomEvent } from './api';
import { avatarHue, avatarInitial } from './avatar';
import { buildTimeline } from './room-run';
import { Badge, cx } from './ui';

/**
 * 协作时间线（UI-10 + 30 §3.1：消息流需区分 Agent 消息 / Tool-Run 事件 / 系统事实）。
 *
 * 遵循调研结论：**只渲染事件派生结果**，不做独立状态。
 * SSE 可能重推历史事件，故由 `buildTimeline` 按 sequence 去重后派生。
 */
export default function RoomTimeline({
  events,
  participants,
}: {
  events: RoomEvent[];
  participants: string[];
}) {
  const blocks = buildTimeline(events);
  const endRef = useRef<HTMLDivElement>(null);

  // 新事件到达时滚到底（仅在用户已经在底部附近时才自动滚动，避免抢滚动条）
  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 240;
    if (nearBottom) el.scrollIntoView({ block: 'end' });
  }, [blocks.length]);

  if (blocks.length === 0) {
    return (
      <p className="wb-muted" style={{ fontSize: 12 }}>
        暂无事件。
      </p>
    );
  }

  return (
    <div className="wb-timeline">
      {blocks.map((b) => {
        if (b.kind === 'system') {
          return (
            <div key={b.key} className="wb-tl__system">
              <span className="wb-muted">#{b.sequence}</span> {b.text}
            </div>
          );
        }
        const hue = avatarHue(b.actorRef);
        const isUser = b.kind === 'user';
        return (
          <div key={b.key} className={cx('wb-tl__msg', isUser && 'wb-tl__msg--user')}>
            <div
              className="wb-avatar"
              aria-hidden="true"
              style={{
                background: isUser ? 'var(--wb-accent)' : `hsl(${hue} 62% 45%)`,
              }}
            >
              {avatarInitial(isUser ? '你' : b.actorRef)}
            </div>
            <div className="wb-tl__body">
              <div className="wb-row" style={{ gap: 6, alignItems: 'center' }}>
                <strong style={{ fontSize: 12, fontWeight: 600 }}>
                  {isUser ? '你（user）' : b.actorRef}
                </strong>
                {!isUser && participants.includes(b.actorRef) ? (
                  <Badge tone="neutral">参与者</Badge>
                ) : null}
                {b.merged > 1 ? <span className="wb-muted">×{b.merged}</span> : null}
                <span className="wb-spacer" />
                <span className="wb-muted">#{b.sequence}</span>
              </div>
              <div className="wb-tl__text">{b.text}</div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
