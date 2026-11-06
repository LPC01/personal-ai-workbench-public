import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Activity,
  Boxes,
  CircleAlert,
  Cpu,
  FolderOpen,
  FolderPlus,
  Gauge,
  ListChecks,
  MemoryStick,
  MessageSquare,
  Wand,
} from 'lucide-react';
import {
  THEME_MODES,
  applyTheme,
  readStoredMode,
  setThemeMode,
  subscribeSystemTheme,
  type ThemeMode,
} from './theme';
import {
  ApiError,
  getLogs,
  getProject,
  getRuntime,
  listProjects,
  registerProject,
  removeProject,
  startRuntime,
  stopRuntime,
  type Project,
} from './api';
import ModelsView from './ModelsView';
import { ProjectDetail, type RuntimeState } from './ProjectDetail';
import { ProjectGrid } from './ProjectGrid';
import AgentRunsView from './AgentRunsView';
import StudioView from './StudioView';
import IssuesView from './IssuesView';
import UsageView from './UsageView';
import DiagnosticsView from './DiagnosticsView';
import RoomsView from './RoomsView';
import MemoryView from './MemoryView';
import { useNarrow } from './use-narrow';
import ProjectManifestForm from './ProjectManifestForm';
import { Alert, Button, Card, CardHead, PageBody, Select, useToast } from './ui';
import {
  buildManifest,
  detectUnmappedBlocks,
  draftFromManifest,
  emptyDraft,
  validateDraft,
  type ManifestDraft,
} from './manifest-draft';

/**
 * 侧栏可达视图。
 *
 * 说明（UI-08）：`runs` 已从本联合类型与下方 `VIEWS` / `NAV_ITEMS` 中移除——
 * 「运行」页签在 UI 上不再可达（含 hash 直达 `#/runs`，会回落到「项目」）。
 * `RunsView` 组件、`api.ts` 的 `listRuns` / `listRunArtifacts` 与全部后端能力
 * 均保留未删，恢复方式见 `docs/decisions/ADR-0002-hide-runs-tab.md`。
 */
type View =
  | 'projects'
  | 'agent'
  | 'models'
  | 'studio'
  | 'issues'
  | 'usage'
  | 'diagnostics'
  | 'rooms'
  | 'memory';

/** 「项目」视图内的二级页签：已有项目列表 / 登记新项目。 */
type ProjectTab = 'list' | 'register';

/** 终态：不会再自行变化。非终态（STARTING / HEALTH_CHECKING / STOPPING）需轮询等待收敛。 */
const TERMINAL_STATUS = new Set(['STOPPED', 'RUNNING', 'UNHEALTHY', 'FAILED']);

/** 非终态的中文说明，用于按钮上的等待态文案。 */
const PENDING_LABEL: Record<string, string> = {
  STARTING: '启动中',
  HEALTH_CHECKING: '健康检查中',
  STOPPING: '停止中',
};

const VIEWS: readonly View[] = [
  'projects',
  'agent',
  'models',
  'studio',
  'issues',
  'usage',
  'diagnostics',
  'rooms',
  'memory',
];

/** 侧栏导航项：图标 + 文字（语义不依赖单一颜色，当前项由边框与底色共同表达）。 */
const NAV_ITEMS: readonly { view: View; label: string; icon: ReactNode }[] = [
  { view: 'projects', label: '项目', icon: <FolderOpen size={16} aria-hidden="true" /> },
  { view: 'agent', label: 'Agent 执行', icon: <Cpu size={16} aria-hidden="true" /> },
  { view: 'models', label: '模型', icon: <Boxes size={16} aria-hidden="true" /> },
  { view: 'studio', label: '工坊', icon: <Wand size={16} aria-hidden="true" /> },
  { view: 'issues', label: 'Issue', icon: <CircleAlert size={16} aria-hidden="true" /> },
  { view: 'usage', label: '用量', icon: <Gauge size={16} aria-hidden="true" /> },
  { view: 'diagnostics', label: '诊断', icon: <Activity size={16} aria-hidden="true" /> },
  { view: 'rooms', label: '聊天室', icon: <MessageSquare size={16} aria-hidden="true" /> },
  { view: 'memory', label: '记忆中心', icon: <MemoryStick size={16} aria-hidden="true" /> },
];

/** 从 URL hash（`#/rooms`）解析当前视图；未知/空 hash 回落到「项目」。 */
function viewFromHash(): View {
  if (typeof window === 'undefined') return 'projects';
  // `#/projects/register` 这类带子页签的 hash 只取首段作为视图
  const name = window.location.hash.replace(/^#\/?/, '').split('/')[0] ?? '';
  return (VIEWS as readonly string[]).includes(name) ? (name as View) : 'projects';
}

/** 从 URL hash 解析「项目」视图的子页签：`#/projects/register` → 登记页。 */
function tabFromHash(): ProjectTab {
  if (typeof window === 'undefined') return 'list';
  const seg = window.location.hash.replace(/^#\/?/, '').split('/');
  return seg[0] === 'projects' && seg[1] === 'register' ? 'register' : 'list';
}

/** 从 URL hash 解析详情页的项目 id：`#/projects/p/<id>` → id（PROJ-UI-01 深链）。 */
function detailIdFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const seg = window.location.hash.replace(/^#\/?/, '').split('/');
  if (seg[0] !== 'projects' || seg[1] !== 'p' || !seg[2]) return null;
  try {
    return decodeURIComponent(seg[2]);
  } catch {
    return seg[2] ?? null;
  }
}

/** 把 manifest 校验失败（422）的 issues 收成一行可读文本。 */
function formatIssues(details: Record<string, unknown>): string {
  const issues = details.issues;
  if (!Array.isArray(issues)) return '';
  return issues
    .slice(0, 5)
    .map((issue) => {
      const item = issue as { instancePath?: unknown; message?: unknown };
      const path = typeof item.instancePath === 'string' ? item.instancePath : '';
      const message = typeof item.message === 'string' ? item.message : '';
      return `${path} ${message}`.trim();
    })
    .filter((line) => line.length > 0)
    .join('；');
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [projectTab, setProjectTab] = useState<ProjectTab>(tabFromHash);
  // 详情页深链（`#/projects/p/<id>`）：有值即渲染详情，为空即渲染卡片网格
  const [detailId, setDetailId] = useState<string | null>(detailIdFromHash);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [runtime, setRuntime] = useState<RuntimeState>(null);
  const [logs, setLogs] = useState('');
  const [error, setError] = useState<string | null>(null);
  // 注销（移除登记）三段式确认：idle → confirm → force（服务在运行时）
  const [removeStage, setRemoveStage] = useState<'idle' | 'confirm' | 'force'>('idle');
  // 登记新项目：表单模式（结构化输入）与 JSON 模式（粘贴完整 manifest）
  const [regMode, setRegMode] = useState<'form' | 'json'>('form');
  const [draft, setDraft] = useState<ManifestDraft>(emptyDraft);
  const [manifestText, setManifestText] = useState('');
  const [registerMsg, setRegisterMsg] = useState<string | null>(null);
  // JSON → 表单 反解时检出的「表单未覆盖区块」提示（防静默丢字段）
  const [jsonHint, setJsonHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 窄屏（≤900px）：侧栏折叠为可展开区块（30 号 §5 移动降级）
  const narrow = useNarrow();
  const toast = useToast();

  useEffect(() => {
    listProjects()
      .then((r) => setProjects(r.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  // hash 与视图双向同步：支持深链 `#/rooms`、`#/projects/register`，并响应浏览器前进/后退。
  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash());
      setProjectTab(tabFromHash());
      setDetailId(detailIdFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const changeView = (v: View) => {
    if (typeof window !== 'undefined' && window.location.hash !== `#/${v}`) {
      window.location.hash = `#/${v}`;
    }
    setView(v);
  };

  /** 切换「项目」视图的子页签：同步进 hash，便于分享与前进/后退。 */
  const changeProjectTab = (t: ProjectTab) => {
    if (typeof window !== 'undefined') {
      const target = t === 'register' ? '#/projects/register' : '#/projects';
      if (window.location.hash !== target) window.location.hash = target;
    }
    setProjectTab(t);
  };

  /** 打开项目详情：同步进 hash，刷新与前进/后退都不会丢。 */
  const openProject = (project: Project) => {
    if (typeof window !== 'undefined') {
      window.location.hash = `#/projects/p/${encodeURIComponent(project.id)}`;
    }
    setDetailId(project.id);
    setSelected(project);
    setRemoveStage('idle');
  };

  /** 回到卡片网格：清深链与选中态。 */
  const backToList = () => {
    if (typeof window !== 'undefined' && window.location.hash !== '#/projects') {
      window.location.hash = '#/projects';
    }
    setDetailId(null);
    setSelected(null);
    setError(null);
  };

  /**
   * 深链 → 选中项目的单向同步。
   * 刷新页面时 projects 是异步加载的，因此依赖 projects：列表到位后立刻选中，
   * 不必等用户再点一次。目标 id 已不在列表里（例如刚被注销）时保持未选中。
   */
  useEffect(() => {
    const id = detailId;
    if (!id) {
      setSelected(null);
      return;
    }
    const found = projects.find((p) => p.id === id);
    if (found) setSelected(found);
  }, [detailId, projects]);

  /**
   * 拉取项目**当前**运行时状态（RT-03）。
   * 此前 `runtime` 只在 start / stop 的响应里赋值，切换视图再回来显示的是陈旧快照，
   * 与服务端真实状态可能不符（known-limitations #25）。
   */
  const refreshRuntime = useCallback(async (projectId: string) => {
    try {
      setRuntime(await getRuntime(projectId));
    } catch {
      setRuntime(null);
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    getProject(selected.id)
      .then(setSelected)
      .catch(() => {});
    getLogs(selected.id)
      .then((l) => setLogs(l.stdout + l.stderr))
      .catch(() => setLogs(''));
    // 选中即查询真实状态，而不是清空为「未知」
    void refreshRuntime(selected.id);
  }, [selected?.id, refreshRuntime]);

  // 非终态时轮询直到收敛：STARTING / HEALTH_CHECKING / STOPPING 不会自己变，
  // 没有这一轮轮询用户会看到「卡住」的状态（正是 #25 的现象）。
  useEffect(() => {
    if (!selected) return undefined;
    const current = (runtime as { status?: string } | null)?.status ?? '';
    if (current.length === 0 || TERMINAL_STATUS.has(current)) return undefined;
    const timer = setTimeout(() => void refreshRuntime(selected.id), 1500);
    return () => clearTimeout(timer);
  }, [runtime, selected?.id, refreshRuntime]);

  // 从其它视图切回「项目」、或从「登记」页签切回列表时，重新取一次真实状态。
  useEffect(() => {
    if (view !== 'projects' || projectTab !== 'list' || !selected) return;
    void refreshRuntime(selected.id);
  }, [view, projectTab, selected?.id, refreshRuntime]);

  async function onStart() {
    if (!selected) return;
    setError(null);
    const projectId = selected.id;
    try {
      const state = await startRuntime(projectId);
      setRuntime(state);
      if (state.status === 'RUNNING') {
        toast.success(`已启动：${selected.name}（端口 ${state.port}），可打开项目 Web UI`);
      } else if (state.status === 'UNHEALTHY') {
        // 诚实：服务已拉起但未通过健康检查，此时打开必然是 ERR_CONNECTION_REFUSED
        toast.warn(
          `已启动但未通过健康检查（${selected.name}）。服务可能仍在加载，请查看运行日志或稍后重试。`,
        );
      } else {
        toast.success(`已启动：${selected.name}（${PENDING_LABEL[state.status] ?? state.status}）`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RUN_STATE_CONFLICT') {
        // 「还在运行中」给出可操作指引，并立刻用真实状态刷新（可能只是上次启动未完成）
        setError(
          '该项目已有运行中的服务实例。请先点「停止」，等状态变为已停止后再启动；若刚点过停止，请稍候。',
        );
        void refreshRuntime(projectId);
      } else {
        setError((e as Error).message);
      }
    }
  }

  async function onStop() {
    if (!selected) return;
    setError(null);
    const projectId = selected.id;
    try {
      const state = await stopRuntime(projectId);
      setRuntime(state);
      toast.info(`已停止：${selected.name}`);
    } catch (e) {
      setError((e as Error).message);
      void refreshRuntime(projectId);
    }
    // 停止完成后再取一次日志，便于确认进程是否真的收尾
    getLogs(projectId)
      .then((l) => setLogs(l.stdout + l.stderr))
      .catch(() => setLogs(''));
  }

  async function refreshProjects() {
    const list = await listProjects();
    setProjects(list.items);
  }

  /**
   * 移除登记（注销）。三段式：先 confirm 二次确认；服务端 409 `PROJECT_IN_USE`
   * （项目有运行中的服务）时才进入 force，由用户显式选择「停止服务并移除」。
   */
  async function onRemove(force: boolean) {
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      const result = await removeProject(selected.id, force);
      const c = result.cascade;
      toast.success(
        `已移除登记：${result.name} — 清理 命令 ${c.commands} / Run ${c.runs} / 事件 ${c.runEvents} / Artifact ${c.artifacts} / 房间绑定 ${c.roomProjects}；磁盘目录保留。`,
      );
      setRemoveStage('idle');
      setSelected(null);
      setRuntime(null);
      setLogs('');
      await refreshProjects();
      // 项目已注销，深链指向的目标不存在了 —— 回列表，否则会停在空详情页
      backToList();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PROJECT_IN_USE') {
        setRemoveStage('force');
        toast.warn('该项目当前有运行中的服务，需确认停止后再移除。');
      } else {
        setError((e as Error).message);
        setRemoveStage('idle');
      }
    } finally {
      setBusy(false);
    }
  }

  /** 提交 manifest：表单与 JSON 两种模式共用同一路径，服务端校验一条不减。 */
  async function submitManifest(manifest: unknown) {
    setBusy(true);
    try {
      const project = await registerProject(manifest);
      toast.success(`已登记：${project.name}（${project.id}）`);
      setRegisterMsg(null);
      setDraft(emptyDraft());
      setManifestText('');
      setJsonHint(null);
      await refreshProjects();
      // 登记成功即回到卡片网格：新卡片出现在列表里就是最直接的反馈，
      // 不自动跳详情页（跳进去会让用户失去「登记前后对比」的上下文）
      setSelected(null);
      setRemoveStage('idle');
      backToList();
      changeProjectTab('list');
    } catch (e) {
      if (e instanceof ApiError) {
        const issues = formatIssues(e.details);
        const msg = `登记失败（${e.code ?? e.status}）：${e.message}${issues ? ` — ${issues}` : ''}`;
        setRegisterMsg(msg);
        toast.error(msg);
      } else {
        const msg = (e as Error).message;
        setRegisterMsg(msg);
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  /** 表单模式登记：前端只负责组装，合法性最终由服务端裁决。 */
  async function onRegisterForm() {
    setError(null);
    setRegisterMsg(null);
    const errors = validateDraft(draft);
    if (errors.length > 0) {
      setRegisterMsg(`表单未通过本地校验：${errors[0]}`);
      return;
    }
    await submitManifest(buildManifest(draft));
  }

  /** JSON 模式登记：原样提交文本区内容（保留 models / memory 等表单未覆盖区块）。 */
  async function onRegisterJson() {
    setError(null);
    setRegisterMsg(null);
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch (e) {
      setRegisterMsg(`JSON 解析失败：${(e as Error).message}`);
      return;
    }
    await submitManifest(manifest);
  }

  /** 切到 JSON：把表单组装结果灌入文本区（表单为源），便于继续手工微调。 */
  function switchToJson() {
    setJsonHint(null);
    setManifestText(JSON.stringify(buildManifest(draft), null, 2));
    setRegMode('json');
  }

  /** 切到表单：尽力反解文本区；检出表单未覆盖的区块时明确提示，不静默丢字段。 */
  function switchToForm() {
    const text = manifestText.trim();
    if (text.length === 0) {
      setJsonHint(null);
      setRegMode('form');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setJsonHint('当前 JSON 无法解析，已保留原文；请先修正内容再切换到表单。');
      return;
    }
    const unmapped = detectUnmappedBlocks(parsed);
    setJsonHint(
      unmapped.length > 0
        ? `表单不覆盖 ${unmapped.join('、')}；改用表单登记时不会提交这些区块（切回 JSON 模式可恢复原文）。`
        : null,
    );
    setDraft(draftFromManifest(parsed));
    setRegMode('form');
  }

  const draftErrors = validateDraft(draft);

  // 登记入口：工作台不扫描磁盘。表单模式产出 manifest、JSON 模式粘贴 manifest，
  // 两者最终都提交给同一个 register 端点（服务端 Schema / 登记根 / 唯一性校验不变）。
  const registerPanel = (
    <div className="wb-col" style={{ maxWidth: 760, width: '100%' }}>
      <Card>
        <CardHead
          title="登记新项目"
          desc="工作台不扫描磁盘：填写表单或粘贴一份 workbench.project/v1 manifest。两种方式的合法性都由服务端裁决，表单校验只是提前拦截。"
        />
        <div role="group" aria-label="登记方式" className="wb-row" style={{ gap: 4 }}>
          <Button
            size="sm"
            variant={regMode === 'form' ? 'primary' : 'ghost'}
            aria-pressed={regMode === 'form'}
            onClick={() => {
              if (regMode !== 'form') switchToForm();
            }}
          >
            表单
          </Button>
          <Button
            size="sm"
            variant={regMode === 'json' ? 'primary' : 'ghost'}
            aria-pressed={regMode === 'json'}
            onClick={() => {
              if (regMode !== 'json') switchToJson();
            }}
          >
            JSON
          </Button>
        </div>

        {regMode === 'form' ? (
          <div className="wb-col" style={{ marginTop: 'var(--wb-space-3)' }}>
            <ProjectManifestForm draft={draft} onChange={setDraft} disabled={busy} />
            <Button
              variant="primary"
              block
              loading={busy}
              disabled={draftErrors.length > 0}
              onClick={onRegisterForm}
            >
              登记
            </Button>
          </div>
        ) : (
          <div className="wb-col" style={{ marginTop: 'var(--wb-space-3)' }}>
            <p className="wb-muted" style={{ fontSize: 12, margin: 0 }}>
              粘贴一份 workbench.project/v1 manifest（工作台不扫描磁盘）。
            </p>
            <textarea
              value={manifestText}
              onChange={(e) => setManifestText(e.target.value)}
              rows={6}
              spellCheck={false}
              aria-label="项目 manifest JSON"
              placeholder='{"schemaVersion":"workbench.project/v1","project":{"id":"my-proj","name":"我的项目"},"runtime":{"root":"C:/Projects/my-proj"}}'
              className="wb-textarea"
            />
            <Button
              variant="primary"
              block
              loading={busy}
              disabled={manifestText.trim().length === 0}
              onClick={onRegisterJson}
            >
              登记
            </Button>
          </div>
        )}

        {jsonHint ? (
          <Alert tone="warn" className="wb-side__note">
            {jsonHint}
          </Alert>
        ) : null}

        {registerMsg ? (
          <p className="wb-muted" style={{ fontSize: 12, margin: 0 }}>
            {registerMsg}
          </p>
        ) : null}
      </Card>
    </div>
  );

  return (
    <div className="wb-shell">
      <Sidebar view={view} onView={changeView} narrow={narrow} />

      <main className="wb-main">
        {view === 'projects' ? (
          <div style={{ display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column' }}>
            <ProjectTabs tab={projectTab} onChange={changeProjectTab} count={projects.length} />

            {projectTab === 'list' ? (
              <div
                role="tabpanel"
                id="project-panel-list"
                aria-labelledby="project-tab-list"
                className="wb-tabpanel"
                style={{ flexDirection: 'column' }}
              >
                {selected !== null && detailId === selected.id ? (
                  // 详情页：深链 `#/projects/p/<id>` 驱动，刷新不丢
                  <ProjectDetail
                    project={selected}
                    runtime={runtime}
                    logs={logs}
                    error={error}
                    busy={busy}
                    removeStage={removeStage}
                    onRemoveStage={setRemoveStage}
                    onStart={onStart}
                    onStop={onStop}
                    onRemove={onRemove}
                    onBack={backToList}
                    narrow={narrow}
                  />
                ) : (
                  <ProjectGrid
                    projects={projects}
                    onOpen={openProject}
                    onRegister={() => changeProjectTab('register')}
                    narrow={narrow}
                  />
                )}
              </div>
            ) : (
              <div
                role="tabpanel"
                id="project-panel-register"
                aria-labelledby="project-tab-register"
                className="wb-tabpanel"
              >
                <PageBody narrow={narrow}>{registerPanel}</PageBody>
              </div>
            )}
          </div>
        ) : null}
        {view === 'agent' ? <AgentRunsView /> : null}
        {view === 'models' ? <ModelsView /> : null}
        {view === 'studio' ? <StudioView /> : null}
        {view === 'issues' ? <IssuesView /> : null}
        {view === 'usage' ? <UsageView /> : null}
        {view === 'diagnostics' ? <DiagnosticsView /> : null}
        {view === 'rooms' ? <RoomsView /> : null}
        {view === 'memory' ? <MemoryView /> : null}
      </main>
    </div>
  );
}

/**
 * 「项目」视图的二级页签：已有项目 / 登记新项目。
 * 登记表单原先挤在窄侧栏里，独立成页签后才有足够宽度；页签状态同步进 hash
 * （`#/projects/register`），可分享也可走浏览器前进/后退。
 * 键盘：← → 切换、Home/End 跳首尾（tablist 惯例），采用 roving tabindex。
 */
function ProjectTabs({
  tab,
  onChange,
  count,
}: {
  tab: ProjectTab;
  onChange: (t: ProjectTab) => void;
  count: number;
}) {
  const items: { id: ProjectTab; label: string; icon: ReactNode; extra?: ReactNode }[] = [
    {
      id: 'list',
      label: '已有项目',
      icon: <ListChecks size={14} aria-hidden="true" />,
      extra: <span className="wb-tab__count">{count}</span>,
    },
    { id: 'register', label: '登记新项目', icon: <FolderPlus size={14} aria-hidden="true" /> },
  ];
  const refs = useRef<Partial<Record<ProjectTab, HTMLButtonElement | null>>>({});

  function onKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    const idx = items.findIndex((i) => i.id === tab);
    if (idx < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = items[next]?.id;
    if (!id) return;
    onChange(id);
    refs.current[id]?.focus();
  }

  return (
    <div className="wb-tabs" role="tablist" aria-label="项目页签">
      {items.map((item) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[item.id] = el;
          }}
          type="button"
          role="tab"
          id={`project-tab-${item.id}`}
          aria-selected={tab === item.id}
          aria-controls={`project-panel-${item.id}`}
          tabIndex={tab === item.id ? 0 : -1}
          className={`wb-tab${tab === item.id ? ' wb-tab--active' : ''}`}
          onClick={() => onChange(item.id)}
          onKeyDown={onKeyDown}
        >
          {item.icon}
          <span>{item.label}</span>
          {item.extra}
        </button>
      ))}
    </div>
  );
}

/** 侧栏：品牌 + 导航 + 主题。窄屏折叠为 <details>（30 号 §5 移动降级）。 */
function Sidebar({
  view,
  onView,
  narrow,
}: {
  view: View;
  onView: (v: View) => void;
  narrow: boolean;
}) {
  // 主题三态（浅色 / 深色 / 跟随系统）：30 号视觉基线 §3.2
  const [mode, setMode] = useState<ThemeMode>(readStoredMode);

  useEffect(() => {
    setThemeMode(mode);
    if (mode !== 'system') return undefined;
    // 跟随系统时，系统偏好变化后重新解析
    return subscribeSystemTheme(() => {
      applyTheme('system');
    });
  }, [mode]);

  const nav = (
    <nav className="wb-nav" aria-label="主导航">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.view}
          onClick={() => onView(item.view)}
          aria-current={view === item.view ? 'page' : undefined}
          className={`wb-nav__item${view === item.view ? ' wb-nav__item--active' : ''}`}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );

  const theme = (
    <label className="wb-side__theme">
      <span>主题</span>
      <Select aria-label="主题" value={mode} onChange={(e) => setMode(e.target.value as ThemeMode)}>
        {THEME_MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </Select>
    </label>
  );

  if (narrow) {
    return (
      <details className="wb-side__narrow">
        <summary className="wb-side__summary">工作台 · 导航</summary>
        <div className="wb-col" style={{ padding: 'var(--wb-space-3)' }}>
          {nav}
          {theme}
        </div>
      </details>
    );
  }

  return (
    <aside className="wb-side">
      <div className="wb-side__brand">
        <FolderOpen size={16} aria-hidden="true" />
        <span>工作台</span>
      </div>
      {nav}
      <div className="wb-side__foot">{theme}</div>
    </aside>
  );
}
