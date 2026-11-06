import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getAgentSession, type AgentSession, type RoomEvent, type RoomRun } from './api';
import { FAILED_RUN_STATUSES, eventCategory, isToolCallEvent } from './room-events';
import { Alert, Badge, Button, StatusBadge } from './ui';

/** 兜底脱敏（26 SPEC §16：Secret 不得出现在 UI 呈现中）。 */
function maskSecrets(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-••••••••');
}

function pretty(value: unknown): string {
  if (value === undefined || value === null) return '—';
  try {
    return maskSecrets(JSON.stringify(value, null, 2));
  } catch {
    return String(value);
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="wb-block">
      <h4 className="wb-block__title">
        {title}
        {typeof count === 'number' ? (
          <span style={{ color: 'var(--wb-text-subtle)', fontWeight: 400 }}> {count}</span>
        ) : null}
      </h4>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="wb-kv">
      {rows.map(([k, v]) => (
        <div key={k} className="wb-kv__row">
          <dt>{k}</dt>
          <dd className="wb-uri">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="wb-muted" style={{ fontSize: 12, margin: 0 }}>
      （{text}）
    </p>
  );
}

function Chips({ items, tone }: { items: string[]; tone: 'ok' | 'bad' }) {
  if (items.length === 0) return <Empty text="无" />;
  return (
    <div className="wb-row" style={{ gap: 4 }}>
      {items.map((t) => (
        <Badge key={t} tone={tone === 'ok' ? 'success' : 'danger'}>
          {t}
        </Badge>
      ))}
    </div>
  );
}

/**
 * 会话检查器（29 号 SPEC §18-5）：查看 AgentProfile/Model 快照、Context 来源、
 * Tool Call、Trace 和错误。只读；不展示隐藏推理。
 */
export default function RoomInspector({
  session,
  events,
  run,
  onClose,
}: {
  session: AgentSession;
  events: RoomEvent[];
  run: RoomRun | null;
  onClose: () => void;
}) {
  const [live, setLive] = useState<AgentSession | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // 打开时刷新一次会话（contextCursor 可能已推进）
  useEffect(() => {
    let cancelled = false;
    getAgentSession(session.id)
      .then((s) => {
        if (!cancelled) setLive(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = live ?? session;
  const mine = useMemo(
    () =>
      events.filter((e) => e.actorRef === s.participantId).sort((a, b) => a.sequence - b.sequence),
    [events, s.participantId],
  );
  const contextEvents = useMemo(
    () => mine.filter((e) => e.eventType === 'CONTEXT_SNAPSHOT_CREATED'),
    [mine],
  );
  const toolCalls = useMemo(() => mine.filter((e) => isToolCallEvent(e.eventType)), [mine]);

  const snapshot = asRecord(s.agentProfileSnapshot) ?? {};
  const definition = asRecord(snapshot.definition) ?? {};
  const profileRows: Array<[string, string]> = [
    ['Profile ID', asString(snapshot.id) ?? '—'],
    ['修订号', snapshot.revision === undefined ? '—' : String(snapshot.revision)],
    ['定义哈希', asString(snapshot.definitionHash)?.slice(0, 16) ?? '—'],
    [
      '默认超时',
      definition.defaultTimeoutSeconds === undefined
        ? '—'
        : `${String(definition.defaultTimeoutSeconds)}s`,
    ],
    ['输入 Schema', definition.inputSchema ? '已定义' : '—'],
    ['输出 Schema', definition.outputSchema ? '已定义' : '—'],
    ['上下文策略', definition.contextPolicy ? '已定义' : '—'],
    ['模型能力要求', definition.modelRequirements ? '已定义' : '—'],
  ];

  const systemInstruction = asString(definition.systemInstruction);
  const runFailed = run !== null && FAILED_RUN_STATUSES.has(run.status);
  const errorEvents = mine.filter((e) => {
    const p = asRecord(e.payload);
    return Boolean(p && (p.error || p.errorCode));
  });

  return (
    <div role="dialog" aria-modal="true" aria-label="会话检查器" className="wb-drawer">
      <div
        className="wb-row"
        style={{ alignItems: 'flex-start', marginBottom: 'var(--wb-space-3)' }}
      >
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 14 }}>会话检查器</strong>
          <div className="wb-muted" style={{ fontSize: 12 }}>
            {s.participantId}
          </div>
        </div>
        <span className="wb-spacer" />
        <Button ref={closeRef} size="sm" onClick={onClose} aria-label="关闭检查器">
          关闭
        </Button>
      </div>

      <Section title="会话概览">
        <Rows
          rows={[
            ['Session ID', s.id],
            ['参与者', s.participantId],
            ['状态', s.status],
            ['上下文游标', String(s.contextCursor)],
            ['创建时间', s.createdAt],
          ]}
        />
      </Section>

      <Section title="AgentProfile 快照">
        <Rows rows={profileRows} />
        {systemInstruction ? (
          <details style={{ marginTop: 6 }}>
            <summary className="wb-link" style={{ fontSize: 12, cursor: 'pointer' }}>
              系统指令（{systemInstruction.length} 字符）
            </summary>
            <pre className="wb-code" style={{ fontSize: 11, marginTop: 6 }}>
              {maskSecrets(systemInstruction)}
            </pre>
          </details>
        ) : null}
      </Section>

      <Section title="Model 绑定">
        <Rows
          rows={[
            ['ModelProfile', s.modelBinding?.modelProfileId ?? '—'],
            ['Provider', s.modelBinding?.providerId ?? '—'],
            [
              '修订号',
              s.modelBinding?.revision === undefined ? '—' : String(s.modelBinding.revision),
            ],
            ['Run 级覆盖', s.modelBinding?.override ? '已设置' : '无'],
          ]}
        />
        {s.modelBinding?.override ? (
          <pre className="wb-code" style={{ fontSize: 11, marginTop: 6 }}>
            {pretty(s.modelBinding.override)}
          </pre>
        ) : null}
      </Section>

      <Section title="工具策略（权限交集）">
        <div className="wb-muted" style={{ fontSize: 12, marginBottom: 4 }}>
          允许
        </div>
        <Chips items={s.toolPolicy?.allowedTools ?? []} tone="ok" />
        <div className="wb-muted" style={{ fontSize: 12, margin: '8px 0 4px' }}>
          拒绝
        </div>
        <Chips items={s.toolPolicy?.deniedTools ?? []} tone="bad" />
        <div className="wb-muted" style={{ fontSize: 11, marginTop: 8 }}>
          权限扩展：{s.toolPolicy?.allowPermissionExpansion ? '已允许（需人工批准）' : '不允许'}
        </div>
      </Section>

      <Section title="Context 来源" count={contextEvents.length}>
        {contextEvents.length === 0 ? (
          <Empty text="暂无 CONTEXT_SNAPSHOT_CREATED 记录" />
        ) : (
          contextEvents.map((e) => (
            <pre key={e.id} className="wb-code" style={{ fontSize: 11, marginBottom: 6 }}>
              {pretty(e.payload)}
            </pre>
          ))
        )}
      </Section>

      <Section title="Tool Call" count={toolCalls.length}>
        {toolCalls.length === 0 ? (
          <Empty text="暂无 TOOL_CALL_* 记录" />
        ) : (
          <ul className="wb-entity-list">
            {toolCalls.map((e) => (
              <li key={e.id} className="wb-entity">
                <div>
                  <span className="wb-muted">#{e.sequence}</span>{' '}
                  <Badge tone="success">{e.eventType}</Badge>
                </div>
                <pre className="wb-code" style={{ fontSize: 11, marginTop: 4 }}>
                  {pretty(e.payload)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Trace" count={mine.length}>
        {mine.length === 0 ? (
          <Empty text="该会话暂无事件" />
        ) : (
          <ol className="wb-entity-list">
            {mine.map((e) => (
              <li key={e.id} className="wb-entity wb-uri">
                <span className="wb-muted">#{e.sequence}</span> {e.eventType}{' '}
                <span className="wb-muted">· {eventCategory(e.eventType)}</span>
                <span className="wb-muted"> · {e.createdAt}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="错误">
        {runFailed || run?.errorCode || errorEvents.length > 0 ? (
          <Alert tone="danger">
            {runFailed ? (
              <div>
                RoomRun 终态：
                <StatusBadge status={run?.status} />
              </div>
            ) : null}
            {run?.errorCode ? <div>错误码：{run.errorCode}</div> : null}
            {errorEvents.map((e) => (
              <div key={e.id}>
                #{e.sequence} {e.eventType} — {pretty(asRecord(e.payload)?.error)}
              </div>
            ))}
          </Alert>
        ) : (
          <Empty text="无错误记录" />
        )}
      </Section>
    </div>
  );
}
