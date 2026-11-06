import { useCallback, useEffect, useRef, useState } from 'react';
import { Cpu, RefreshCw, Send, Square } from 'lucide-react';
import { HarnessProfilePanel } from './HarnessProfilePanel';
import {
  cancelAgentRun,
  getRun,
  listHarnessProfiles,
  listProfiles,
  listProjects,
  listRunEvents,
  probeHarnessProfile,
  resumeAgentRun,
  sendAgentTurn,
  startAgentRun,
  type AgentSessionRecord,
  type HarnessProfile,
  type ModelProfile,
  type Project,
  type Run,
  type RunEvent,
} from './api';
import { useNarrow } from './use-narrow';
import {
  Alert,
  Button,
  Card,
  CardHead,
  EmptyState,
  Field,
  LogView,
  PageBody,
  PageHead,
  Select,
  StatusBadge,
  Textarea,
} from './ui';

/**
 * Agent 执行视图（26 SPEC §13 + §10.2）：把 SEC-02 接线的 `/agent-runs` 闭环搬到界面。
 *
 * - 选 Harness Profile → 起 Run（kind=agent）+ Session 绑定；
 * - 逐回合驱动（含工具回环 / 超时 / 取消），事件流复用 `/runs/{runId}/events`（轮询增量）；
 * - 断线 / 刷新后按 Session 恢复（游标续传）。
 *
 * 说明：26 §10.3 未定义 Agent 执行界面的视觉基线，本页遵循 30 号 §3.2 设计令牌与窄屏降级约定。
 */

/** Harness 工具白名单（镜像 contracts `harnessToolIds`，26 SPEC §13；apps/web 无 workspace 依赖故本地复制）。 */
const HARNESS_TOOLS = [
  'project.describe',
  'project.commands.list',
  'project.command.run',
  'run.status',
  'run.events',
  'run.cancel',
  'artifact.list',
  'artifact.read',
  'artifact.publish',
  'memory.search',
  'memory.read',
  'memory.candidate',
  'approval.request',
  'approval.status',
] as const;

/** 终态：非终态时页面按 1.5s 轮询增量事件（SSE 由 /runs/{id}/stream 提供，此处用轮询以贴合既有页面风格）。 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'REJECTED',
  'TIMED_OUT',
  'BUDGET_EXCEEDED',
]);

export default function AgentRunsView() {
  const [harnessProfiles, setHarnessProfiles] = useState<HarnessProfile[]>([]);
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [harnessProfileId, setHarnessProfileId] = useState('');
  const [modelProfileId, setModelProfileId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');

  const [session, setSession] = useState<AgentSessionRecord | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [turnPrompt, setTurnPrompt] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const narrow = useNarrow();
  const formPanelRef = useRef<HTMLDetailsElement>(null);

  /** 重新拉取 Harness Profile；传入 id 时选中它（新建后直接落到发起表单）。 */
  const reloadHarness = useCallback(async (selectId?: string) => {
    const r = await listHarnessProfiles();
    setHarnessProfiles(r.items);
    if (selectId) setHarnessProfileId(selectId);
    else setHarnessProfileId((prev) => prev || (r.items[0]?.id ?? ''));
  }, []);

  useEffect(() => {
    reloadHarness().catch((e: Error) => setError(e.message));
    listProfiles()
      .then((r) => {
        setModelProfiles(r.items);
        setModelProfileId((prev) => prev || (r.items[0]?.id ?? ''));
      })
      .catch(() => {});
    listProjects()
      .then((r) => setProjects(r.items))
      .catch(() => {});
  }, [reloadHarness]);

  /** 增量拉取事件 + Run 最新状态（轮询与手动刷新共用）。 */
  const refresh = useCallback(async (runId: string) => {
    const [r, ev] = await Promise.all([getRun(runId), listRunEvents(runId)]);
    setRun(r);
    setEvents(ev.items);
    return r;
  }, []);

  // 非终态时轮询（Agent Run 起后处于 RUNNING，直至某回合结束或取消）。
  useEffect(() => {
    if (!run || TERMINAL_STATUSES.has(run.status)) return undefined;
    const timer = window.setInterval(() => {
      refresh(run.id).catch(() => {});
    }, 1500);
    return () => window.clearInterval(timer);
  }, [run?.id, run?.status, refresh]);

  async function onStart() {
    setError(null);
    setNotice(null);
    if (!harnessProfileId) {
      setError('请选择 Harness Profile');
      return;
    }
    if (!modelProfileId) {
      setError('请选择模型 Profile');
      return;
    }
    if (!prompt.trim()) {
      setError('请填写起始指令');
      return;
    }
    setBusy(true);
    try {
      const result = await startAgentRun({
        harnessProfileId,
        modelProfileId,
        prompt: prompt.trim(),
        projectId: projectId || undefined,
        toolPolicy: { allowedToolIds: toolIds },
      });
      setSession(result.session);
      setRun(result.run);
      setEvents([]);
      await refresh(result.run.id).catch(() => {});
      setNotice(`已发起 Agent Run：${result.run.id}`);
      formPanelRef.current?.removeAttribute('open');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onTurn() {
    if (!session) return;
    setError(null);
    if (!turnPrompt.trim()) {
      setError('请填写本回合指令');
      return;
    }
    setBusy(true);
    try {
      const { run: updated } = await sendAgentTurn(session.id, turnPrompt.trim());
      setTurnPrompt('');
      await refresh(updated.id).catch(() => {});
      setNotice(`回合完成：${updated.status}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!session) return;
    setError(null);
    setBusy(true);
    try {
      const { run: updated } = await cancelAgentRun(session.id);
      await refresh(updated.id).catch(() => {});
      setNotice('已请求取消');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onResume() {
    if (!session) return;
    setError(null);
    setBusy(true);
    try {
      const result = await resumeAgentRun(session.id);
      setSession(result.session);
      if (result.run) {
        await refresh(result.run.id).catch(() => {});
      } else {
        setRun(null);
      }
      setNotice(`已按游标恢复（快照事件 ${result.events.length} 条）`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onProbe() {
    if (!harnessProfileId) return;
    setError(null);
    setNotice(null);
    try {
      const result = await probeHarnessProfile(harnessProfileId);
      setNotice(
        `Harness 探测：${result.adapterType} · ${result.health.ok ? '可用' : '不可用'}${
          result.health.detail ? `（${result.health.detail}）` : ''
        }`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const toggleTool = (id: string) =>
    setToolIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const form = (
    <div className="wb-col">
      <Field
        label="Harness Profile"
        hint={harnessProfiles.length === 0 ? '暂无 Harness Profile，请先通过 API 创建' : undefined}
      >
        <Select
          aria-label="Harness Profile"
          value={harnessProfileId}
          onChange={(e) => setHarnessProfileId(e.target.value)}
        >
          {harnessProfiles.length === 0 ? <option value="">（暂无）</option> : null}
          {harnessProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.adapterType} · r{p.revision}）
            </option>
          ))}
        </Select>
      </Field>
      <Button size="sm" onClick={onProbe} disabled={!harnessProfileId}>
        探测健康
      </Button>

      <Field label="模型 Profile">
        <Select
          aria-label="模型 Profile"
          value={modelProfileId}
          onChange={(e) => setModelProfileId(e.target.value)}
        >
          {modelProfiles.length === 0 ? <option value="">（暂无模型 Profile）</option> : null}
          {modelProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.modelId} · {p.dataBoundary}）
            </option>
          ))}
        </Select>
      </Field>

      <Field label="绑定项目" hint="可选；绑定后 Agent 可使用项目内命令。">
        <Select
          aria-label="绑定项目"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">（不绑定项目）</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>

      <div>
        <div className="wb-field__label" style={{ marginBottom: 4 }}>
          工具白名单（{toolIds.length} / {HARNESS_TOOLS.length}）
        </div>
        <div className="wb-check-grid">
          {HARNESS_TOOLS.map((id) => (
            <label key={id} className="wb-check">
              <input
                type="checkbox"
                checked={toolIds.includes(id)}
                onChange={() => toggleTool(id)}
              />
              <span className="wb-mono">{id}</span>
            </label>
          ))}
        </div>
      </div>

      <Field label="起始指令">
        <Textarea
          aria-label="起始指令"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="例如：描述当前项目并列出可用命令"
        />
      </Field>

      <Button variant="primary" block loading={busy} onClick={onStart}>
        启动 Agent Run
      </Button>
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minWidth: 0,
        flexDirection: narrow ? 'column' : 'row',
      }}
    >
      {narrow ? (
        <details ref={formPanelRef} className="wb-side__narrow">
          <summary className="wb-side__summary">发起 Agent Run</summary>
          <div style={{ padding: 'var(--wb-space-3)' }}>
            <HarnessProfilePanel
              profiles={harnessProfiles}
              onChanged={(id) => {
                reloadHarness(id).catch((e: Error) => setError(e.message));
              }}
            />
            {form}
          </div>
        </details>
      ) : (
        <aside className="wb-panel-col" style={{ width: 320, overflowY: 'auto' }}>
          <HarnessProfilePanel
            profiles={harnessProfiles}
            onChanged={(id) => {
              reloadHarness(id).catch((e: Error) => setError(e.message));
            }}
          />
          <h2 className="wb-side__title">发起 Agent Run</h2>
          {form}
        </aside>
      )}

      <PageBody narrow={narrow}>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {notice ? <Alert tone="info">{notice}</Alert> : null}

        {!session ? (
          <Card>
            <EmptyState
              icon={<Cpu size={28} aria-hidden="true" />}
              title="尚未发起 Agent Run"
              desc="在左侧选择 Harness / 模型 Profile 并填写起始指令，发起一次 Agent 执行。"
            />
          </Card>
        ) : (
          <>
            <PageHead
              title="Agent 执行"
              desc={
                <span>
                  Session {session.id} · Harness {session.harnessProfileId} · 模型{' '}
                  {session.modelProfileId} · 游标 {session.contextCursor}
                  {run ? (
                    <>
                      {' · Run '}
                      <span className="wb-mono">{run.id}</span>
                      {' · '}
                      <StatusBadge status={run.status} />
                      {run.errorCode ? ` · ${run.errorCode}` : ''}
                    </>
                  ) : null}
                </span>
              }
              actions={
                <>
                  <Button
                    icon={<RefreshCw size={14} aria-hidden="true" />}
                    onClick={() => run && refresh(run.id)}
                  >
                    刷新事件
                  </Button>
                  <Button disabled={busy} onClick={onResume}>
                    恢复会话
                  </Button>
                  <Button variant="danger-ghost" disabled={busy} onClick={onCancel}>
                    取消
                  </Button>
                </>
              }
            />

            <Card>
              <CardHead title="本回合指令" desc="逐回合驱动；工具回环由服务端裁决。" />
              <div className="wb-col">
                <Textarea
                  aria-label="本回合指令"
                  value={turnPrompt}
                  onChange={(e) => setTurnPrompt(e.target.value)}
                  rows={2}
                  placeholder="继续对话 / 触发工具"
                />
                <div>
                  <Button
                    variant="primary"
                    icon={<Send size={14} aria-hidden="true" />}
                    loading={busy}
                    onClick={onTurn}
                  >
                    发送回合
                  </Button>
                </div>
              </div>
            </Card>

            <Card>
              <CardHead
                title={`事件流（${events.length}）`}
                desc="非终态时每 1.5 秒增量拉取一次。"
                actions={
                  run ? (
                    <Button
                      size="sm"
                      variant="danger-ghost"
                      icon={<Square size={14} aria-hidden="true" />}
                      disabled={busy || TERMINAL_STATUSES.has(run.status)}
                      onClick={onCancel}
                    >
                      取消
                    </Button>
                  ) : null
                }
              />
              <LogView
                label="Agent 事件流"
                emptyText="（暂无事件）"
                text={
                  events.length === 0
                    ? ''
                    : events
                        .map((e) => `#${e.sequence} ${e.eventType} ${JSON.stringify(e.payload)}`)
                        .join('\n')
                }
              />
            </Card>
          </>
        )}
      </PageBody>
    </div>
  );
}
