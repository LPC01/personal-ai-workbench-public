import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { MessageSquare, Pause, Play, Plus, RefreshCw } from 'lucide-react';
import {
  activateRoom,
  cancelRoomRun,
  createRoom,
  createRoomRun,
  finishRoomRun,
  getRoomRun,
  listAgentSessions,
  listDecisions,
  listHarnessProfiles,
  listProfiles,
  listRoomEvents,
  listRoomProjects,
  listRooms,
  listRoomRuns,
  listWorkItems,
  pauseRoomRun,
  resumeRoomRun,
  startRuntime,
  subscribeRoomRunStream,
  type AgentSession,
  type Decision,
  type HarnessProfile,
  type ModelProfile,
  type Room,
  type RoomEvent,
  type RoomProjectBinding,
  type RoomRun,
  type RoomWorkItem,
} from './api';
import RoomComposer from './RoomComposer';
import RoomInspector from './RoomInspector';
import RoomTaskBoard from './RoomTaskBoard';
import RoomTimeline from './RoomTimeline';
import RoomRunSetup from './RoomRunSetup';
import SddRoomPanel from './SddRoomPanel';
import { lastAgentSpeaker } from './room-run';
import { useNarrow } from './use-narrow';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Field,
  Input,
  StatusBadge,
  cx,
} from './ui';

/** 侧栏：宽屏固定列，窄屏折叠为可展开区块（30 号 §5 移动降级）。 */
function Side({
  narrow,
  title,
  side,
  children,
}: {
  narrow: boolean;
  title: string;
  side: 'left' | 'right';
  children: ReactNode;
}) {
  if (!narrow) {
    return (
      <aside
        className={cx('wb-panel-col', side === 'left' ? 'wb-panel-col--sm' : 'wb-panel-col--md')}
        style={
          side === 'right'
            ? { borderRight: 'none', borderLeft: '1px solid var(--wb-border)' }
            : undefined
        }
      >
        {children}
      </aside>
    );
  }
  return (
    <details className="wb-side__narrow" style={{ borderTop: '1px solid var(--wb-border)' }}>
      <summary className="wb-side__summary">{title}</summary>
      <div className="wb-col" style={{ padding: 'var(--wb-space-3)' }}>
        {children}
      </div>
    </details>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="wb-block">
      <h3 className="wb-block__title">{title}</h3>
      {children}
    </section>
  );
}

function Muted({ text }: { text: string }) {
  return (
    <p className="wb-muted" style={{ fontSize: 12, margin: 0 }}>
      {text}
    </p>
  );
}

/** 预算进度条（只画真实数据，超出即封顶，不编造百分比）。 */
function BudgetBar({ label, used, limit }: { label: string; used: unknown; limit: unknown }) {
  const u = typeof used === 'number' ? used : 0;
  const l = typeof limit === 'number' && limit > 0 ? limit : 0;
  const ratio = l === 0 ? 0 : Math.min(1, u / l);
  return (
    <div className="wb-kv__row">
      <dt>{label}</dt>
      <dd>
        <span className="wb-bar" aria-hidden="true">
          <span className="wb-bar__fill" style={{ width: `${ratio * 100}%` }} />
        </span>
        <span className="wb-muted" style={{ marginLeft: 6 }}>
          {u}
          {l > 0 ? ` / ${l}` : '（未设上限）'}
        </span>
      </dd>
    </div>
  );
}

/**
 * 聊天室界面（29 号 SPEC §18 + 30 号基线 §3.1 MUST）。
 *
 * UI-10 补齐的核心是「编排接线」：此前本页只能建 Run 与记 USER_MESSAGE，
 * 编排引擎（start/turn/handoff/work-items/finish）在前端零调用，右侧栏永远为空。
 */
export default function RoomsView() {
  const narrow = useNarrow();

  const [name, setName] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RoomRun | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [workItems, setWorkItems] = useState<RoomWorkItem[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [bindings, setBindings] = useState<RoomProjectBinding[]>([]);
  const [roomRuns, setRoomRuns] = useState<RoomRun[]>([]);
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([]);
  const [harnessProfiles, setHarnessProfiles] = useState<HarnessProfile[]>([]);
  const [inspected, setInspected] = useState<AgentSession | null>(null);
  const [runtimeUrl, setRuntimeUrl] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<'connecting' | 'open' | 'error'>('connecting');
  const [dataVersion, setDataVersion] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshRooms = useCallback(async () => {
    try {
      const r = await listRooms();
      setRooms(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshRun = useCallback(async (runId: string) => {
    try {
      const [r, ev, se, wi, de] = await Promise.all([
        getRoomRun(runId),
        listRoomEvents(runId),
        listAgentSessions(runId),
        listWorkItems(runId),
        listDecisions(runId),
      ]);
      setRun(r);
      setEvents(ev.items);
      setSessions(se.items);
      setWorkItems(wi);
      setDecisions(de.items);
      setDataVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshRooms();
    // 编排配置面板需要这两份列表（后端已具备、此前未接线）
    listProfiles()
      .then((r) => setModelProfiles(r.items))
      .catch(() => setModelProfiles([]));
    listHarnessProfiles()
      .then((r) => setHarnessProfiles(r.items))
      .catch(() => setHarnessProfiles([]));
  }, [refreshRooms]);

  // SSE 实时事件流：连接建立后增量追加，按 sequence 去重（服务端可能重推历史）
  useEffect(() => {
    if (!activeRunId) return;
    setStreamState('connecting');
    const unsub = subscribeRoomRunStream(activeRunId, {
      onStatus: setStreamState,
      onEvent: (ev) => {
        setEvents((prev) => {
          if (prev.some((e) => e.sequence === ev.sequence)) return prev;
          const next = [
            ...prev,
            {
              id: ev.sequence,
              roomRunId: activeRunId,
              sequence: ev.sequence,
              eventType: ev.eventType,
              actorRef: 'system',
              payload: ev.payload ?? {},
              createdAt: ev.createdAt,
            },
          ];
          return next.sort((a, b) => a.sequence - b.sequence);
        });
      },
    });
    return unsub;
  }, [activeRunId]);

  const activeRoomId = activeRoom?.id ?? null;
  useEffect(() => {
    if (!activeRoomId) {
      setBindings([]);
      setRoomRuns([]);
      return;
    }
    listRoomProjects(activeRoomId)
      .then((r) => setBindings(r.items))
      .catch(() => setBindings([]));
    listRoomRuns(activeRoomId)
      .then((r) => setRoomRuns(r.items))
      .catch(() => setRoomRuns([]));
  }, [activeRoomId, dataVersion]);

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      await createRoom({
        name: name || '未命名聊天室',
        roomType: 'general',
        manifest: { id: `room_${Date.now()}`, name: name || '未命名聊天室' },
      });
      setName('');
      await refreshRooms();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onActivate(roomId: string) {
    setError(null);
    try {
      await activateRoom(roomId);
      await refreshRooms();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onStartRun(room: Room) {
    setError(null);
    setActiveRoom(room);
    setRuntimeUrl(null);
    try {
      const created = await createRoomRun(room.id, {
        protocolId: 'sequential',
        protocolVersion: '1.0',
      });
      setActiveRunId(created.id);
      await refreshRun(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onSelectRun(runId: string) {
    setError(null);
    setActiveRunId(runId);
    await refreshRun(runId);
  }

  async function onTogglePause() {
    if (!activeRunId || !run) return;
    setError(null);
    try {
      if (run.status === 'PAUSED') await resumeRoomRun(activeRunId);
      else await pauseRoomRun(activeRunId);
      await refreshRun(activeRunId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onFinish() {
    if (!activeRunId) return;
    setError(null);
    try {
      await finishRoomRun(activeRunId, 'SUCCEEDED');
      await refreshRun(activeRunId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onCancel() {
    if (!activeRunId) return;
    setError(null);
    try {
      await cancelRoomRun(activeRunId);
      await refreshRun(activeRunId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** 进入绑定项目的原生 Web UI（30 号 MUST：聊天室可进入项目 UI）。 */
  async function onOpenProjectUI() {
    const projectId = bindings[0]?.projectId;
    if (!projectId) {
      setError('该聊天室尚未绑定项目，无法进入项目 Web UI');
      return;
    }
    setError(null);
    try {
      const state = await startRuntime(projectId);
      setRuntimeUrl(`http://127.0.0.1:${state.port}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const roomOfRun = rooms.find((r) => r.id === run?.roomId) ?? activeRoom;
  const participants = sessions.map((s) => s.participantId);
  const notStarted = run?.status === 'CREATED';
  const live = run?.status === 'RUNNING' || run?.status === 'PAUSED';

  return (
    <>
      <div
        style={{
          display: 'flex',
          flex: 1,
          minWidth: 0,
          flexDirection: narrow ? 'column' : 'row',
          alignItems: 'stretch',
        }}
      >
        <Side narrow={narrow} title={`聊天室列表（${rooms.length}）`} side="left">
          <h2 className="wb-side__title">聊天室</h2>
          <div className="wb-col" style={{ gap: 'var(--wb-space-2)' }}>
            <Field label="新建聊天室">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="聊天室名称"
                aria-label="聊天室名称"
              />
            </Field>
            <div className="wb-row" style={{ gap: 6 }}>
              <Button
                size="sm"
                variant="primary"
                icon={<Plus size={14} aria-hidden="true" />}
                loading={busy}
                onClick={onCreate}
              >
                创建
              </Button>
              <Button
                size="sm"
                icon={<RefreshCw size={14} aria-hidden="true" />}
                onClick={refreshRooms}
              >
                刷新
              </Button>
            </div>
          </div>

          <div style={{ marginTop: 'var(--wb-space-4)' }}>
            {rooms.length === 0 ? (
              <Muted text="暂无聊天室，先创建一个。" />
            ) : (
              <ul className="wb-list">
                {rooms.map((room) => (
                  <li key={room.id}>
                    <button
                      onClick={() => setActiveRoom(room)}
                      className={`wb-list__item${
                        activeRoom?.id === room.id ? ' wb-list__item--active' : ''
                      }`}
                    >
                      <span className="wb-list__title">{room.name}</span>
                      <span className="wb-list__sub wb-uri">
                        {room.roomType} · {room.id}
                      </span>
                      <span className="wb-row" style={{ gap: 6, marginTop: 6 }}>
                        <Badge tone={room.status === 'ACTIVE' ? 'success' : 'neutral'}>
                          {room.status}
                        </Badge>
                      </span>
                    </button>
                    <div className="wb-row" style={{ gap: 6, marginTop: 4 }}>
                      {room.status === 'DRAFT' ? (
                        <Button size="sm" onClick={() => onActivate(room.id)}>
                          激活
                        </Button>
                      ) : null}
                      {room.status === 'ACTIVE' ? (
                        <Button size="sm" onClick={() => onStartRun(room)}>
                          新建 Run
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Block title="绑定项目">
            {!activeRoom ? (
              <Muted text="选择一个聊天室以查看绑定项目。" />
            ) : bindings.length === 0 ? (
              <Muted text="未绑定项目。" />
            ) : (
              <ul className="wb-entity-list">
                {bindings.map((b) => (
                  <li key={b.projectId} className="wb-entity">
                    <strong style={{ fontWeight: 600 }}>{b.projectId}</strong>{' '}
                    <span className="wb-muted">
                      权限 {String((b.access as { access?: string }).access ?? 'read')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title={`历史 Run（${roomRuns.length}）`}>
            {!activeRoom ? (
              <Muted text="选择一个聊天室以查看历史 Run。" />
            ) : roomRuns.length === 0 ? (
              <Muted text="该聊天室暂无 Run。" />
            ) : (
              <ul className="wb-list">
                {roomRuns.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => void onSelectRun(r.id)}
                      aria-label={`切换到 Run ${r.id}`}
                      className={`wb-list__item${r.id === activeRunId ? ' wb-list__item--active' : ''}`}
                    >
                      <span className="wb-row" style={{ gap: 6 }}>
                        <StatusBadge status={r.status} />
                        <span className="wb-muted" style={{ fontSize: 11 }}>
                          {r.protocolId}@{r.protocolVersion}
                        </span>
                      </span>
                      <span className="wb-list__sub wb-uri">{r.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        </Side>

        <div
          className="wb-col"
          style={{
            flex: 1,
            minWidth: 0,
            padding: narrow ? 'var(--wb-space-3)' : 'var(--wb-space-4)',
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}

          {!activeRunId ? (
            <Card>
              <EmptyState
                icon={<MessageSquare size={28} aria-hidden="true" />}
                title="尚未选择 Run"
                desc="从左侧选一个聊天室并「新建 Run」，或点历史 Run 回看。"
              />
            </Card>
          ) : (
            <>
              <Card>
                <CardHead
                  title={roomOfRun?.name ?? run?.roomId ?? '—'}
                  desc={
                    <span>
                      {roomOfRun?.roomType ?? '—'} · 协议 {run?.protocolId}@{run?.protocolVersion} ·
                      事件流{' '}
                      {streamState === 'open'
                        ? '已连接'
                        : streamState === 'error'
                          ? '断开'
                          : '连接中'}
                    </span>
                  }
                  actions={
                    <>
                      <StatusBadge status={run?.status} />
                      {live ? (
                        <Button size="sm" onClick={onTogglePause}>
                          {run?.status === 'PAUSED' ? (
                            <>
                              <Play size={14} aria-hidden="true" /> 继续
                            </>
                          ) : (
                            <>
                              <Pause size={14} aria-hidden="true" /> 暂停
                            </>
                          )}
                        </Button>
                      ) : null}
                      {live ? (
                        <Button size="sm" onClick={onFinish}>
                          结束（成功）
                        </Button>
                      ) : null}
                      {live ? (
                        <Button size="sm" variant="danger-ghost" onClick={onCancel}>
                          取消
                        </Button>
                      ) : null}
                      <Button size="sm" onClick={onOpenProjectUI}>
                        {runtimeUrl ? '进入项目 UI' : '启动并进入项目 UI'}
                      </Button>
                    </>
                  }
                />
              </Card>

              <SddRoomPanel
                runId={activeRunId}
                refreshToken={dataVersion}
                onDecided={() => void refreshRun(activeRunId)}
              />

              {notStarted ? (
                <RoomRunSetup
                  runId={activeRunId}
                  modelProfiles={modelProfiles}
                  harnessProfiles={harnessProfiles}
                  onStarted={() => void refreshRun(activeRunId)}
                />
              ) : (
                <RoomComposer
                  runId={activeRunId}
                  participants={participants}
                  lastAgentSpeaker={lastAgentSpeaker(events)}
                  disabled={!live}
                  onSent={() => void refreshRun(activeRunId)}
                />
              )}

              <Card>
                <CardHead
                  title={`协作时间线 · ${activeRunId.slice(0, 12)}`}
                  desc="用户消息 / Agent 发言 / 系统事实事件，实时追加。"
                  actions={
                    <Button size="sm" onClick={() => void refreshRun(activeRunId)}>
                      刷新
                    </Button>
                  }
                />
                <RoomTimeline events={events} participants={participants} />
              </Card>
            </>
          )}
        </div>

        <Side narrow={narrow} title="参与者 · 任务板 · 预算 · 裁决" side="right">
          <Block title={`参与者与会话（${sessions.length}）`}>
            {sessions.length === 0 ? (
              <Muted text="编排尚未启动：启动后这里显示每位参与者的独立会话。" />
            ) : (
              <ul className="wb-entity-list">
                {sessions.map((s) => (
                  <li key={s.id} className="wb-entity">
                    <div className="wb-row" style={{ gap: 6 }}>
                      <strong style={{ fontWeight: 600 }}>{s.participantId}</strong>
                      <StatusBadge status={s.status} />
                      <Button size="sm" onClick={() => setInspected(s)}>
                        检查
                      </Button>
                    </div>
                    <div className="wb-muted">
                      模型 {s.modelBinding?.modelProfileId || '—'} · 游标 {s.contextCursor}
                    </div>
                    <div className="wb-muted">
                      {s.agentProfileSnapshot?.harnessSessionId
                        ? '已绑定 Harness（可自动发言）'
                        : '未绑定 Harness（仅人工代发言）'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title="共享任务板">
            {!activeRunId ? (
              <Muted text="选择一个 Run 以查看任务板。" />
            ) : (
              <RoomTaskBoard
                runId={activeRunId}
                items={workItems}
                participants={participants}
                onChanged={() => void refreshRun(activeRunId)}
              />
            )}
          </Block>

          <Block title="运行预算">
            <dl className="wb-kv">
              <BudgetBar label="轮次" used={run?.usage?.turns} limit={run?.budget?.maxTurns} />
              <BudgetBar
                label="Token"
                used={run?.usage?.totalTokens}
                limit={run?.budget?.maxTotalTokens}
              />
              <BudgetBar label="成本" used={run?.usage?.cost} limit={run?.budget?.maxCost} />
              <div className="wb-kv__row">
                <dt>时长上限(s)</dt>
                <dd>{String(run?.budget?.maxDurationSeconds ?? '未设置')}</dd>
              </div>
            </dl>
            <p className="wb-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Token 为按字符数估算（4 字符≈1 token），非模型侧真实计费。
            </p>
          </Block>

          <Block title="当前裁决">
            {decisions.length === 0 ? (
              <Muted text="暂无裁决。" />
            ) : (
              <ul className="wb-entity-list">
                {decisions.map((d) => (
                  <li key={d.id} className="wb-decision">
                    <strong style={{ fontWeight: 600 }}>{d.decisionType}</strong>
                    {d.result?.summary ? <span> — {String(d.result.summary)}</span> : null}
                    {d.evidenceRefs.length > 0 ? (
                      <div className="wb-muted">证据：{d.evidenceRefs.join(', ')}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Block>
        </Side>
      </div>

      {inspected ? (
        <RoomInspector
          session={inspected}
          events={events}
          run={run}
          onClose={() => setInspected(null)}
        />
      ) : null}
    </>
  );
}
