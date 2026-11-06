import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  FileText,
  Hash,
  Play,
  Settings,
  Square,
} from 'lucide-react';
import { avatarHue, avatarInitial } from './avatar';
import { getReadme, type Project, type ProjectReadme, type ServiceState } from './api';
import { MarkdownView } from './MarkdownView';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  LogView,
  PageBody,
  StatusBadge,
} from './ui';

/** 运行时状态：`null` 表示尚未查询（与「已停止」区分开，避免首个渲染帧闪烁 STOPPED）。 */
export type RuntimeState = ServiceState | { status: 'STOPPED' } | null;

type DetailTab = 'readme' | 'logs' | 'manage';

/** 终态：不会再自行变化。非终态（STARTING / HEALTH_CHECKING / STOPPING）由外层轮询收敛。 */
const TERMINAL_STATUS = new Set(['STOPPED', 'RUNNING', 'UNHEALTHY', 'FAILED']);

const PENDING_LABEL: Record<string, string> = {
  STARTING: '启动中',
  HEALTH_CHECKING: '健康检查中',
  STOPPING: '停止中',
};

const TABS: readonly { id: DetailTab; label: string; icon: ReactNode }[] = [
  { id: 'readme', label: '简介', icon: <BookOpen size={14} aria-hidden="true" /> },
  { id: 'logs', label: '运行日志', icon: <FileText size={14} aria-hidden="true" /> },
  { id: 'manage', label: '管理', icon: <Settings size={14} aria-hidden="true" /> },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface ProjectDetailProps {
  project: Project;
  runtime: RuntimeState;
  logs: string;
  error: string | null;
  busy: boolean;
  removeStage: 'idle' | 'confirm' | 'force';
  onRemoveStage: (stage: 'idle' | 'confirm' | 'force') => void;
  onStart: () => void;
  onStop: () => void;
  onRemove: (force: boolean) => void;
  onBack: () => void;
  narrow: boolean;
}

/**
 * 项目详情页（PROJ-UI-01）：深色横幅 + 三页签。
 *
 * 深链由外层 hash（`#/projects/p/<id>`）驱动，刷新后仍停留在本页。
 * 「简介」渲染项目登记根顶层的自述文件；读不到是**正常空态**而非错误。
 */
export function ProjectDetail({
  project,
  runtime,
  logs,
  error,
  busy,
  removeStage,
  onRemoveStage,
  onStart,
  onStop,
  onRemove,
  onBack,
  narrow,
}: ProjectDetailProps) {
  const [tab, setTab] = useState<DetailTab>('readme');
  const [readme, setReadme] = useState<ProjectReadme | null>(null);
  const [readmeError, setReadmeError] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReadmeLoading(true);
    setReadmeError(null);
    setReadme(null);
    getReadme(project.id)
      .then((result) => {
        if (!cancelled) setReadme(result);
      })
      .catch((e: Error) => {
        if (!cancelled) setReadmeError(e.message);
      })
      .finally(() => {
        if (!cancelled) setReadmeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const status = (runtime as { status?: string } | null)?.status ?? 'STOPPED';
  const pending = !TERMINAL_STATUS.has(status);
  const port = (runtime as ServiceState | null)?.port ?? 0;
  const canOpen = status === 'RUNNING' && port > 0;
  const uiUrl = `http://127.0.0.1:${port}`;
  const hue = avatarHue(project.id);

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    const index = TABS.findIndex((item) => item.id === tab);
    if (index < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = TABS[next]?.id;
    if (id) setTab(id);
  }

  return (
    <PageBody narrow={narrow}>
      <div className="wb-banner">
        <div className="wb-banner__top">
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowLeft size={14} aria-hidden="true" />}
            onClick={onBack}
          >
            返回项目列表
          </Button>
        </div>

        <div className="wb-banner__body">
          <span
            className="wb-avatar wb-avatar--lg"
            style={{ background: `hsl(${hue} 62% 42%)` }}
            aria-hidden="true"
          >
            {avatarInitial(project.name)}
          </span>

          <div className="wb-banner__meta">
            <h1 className="wb-banner__title">{project.name}</h1>
            <p className="wb-banner__desc">
              {project.description?.trim() ? (
                project.description
              ) : (
                <span className="wb-muted">
                  该项目未填写简介（manifest 的 project.description）
                </span>
              )}
            </p>
            <div className="wb-row wb-banner__badges">
              <Badge tone="neutral" icon={<Hash size={11} aria-hidden="true" />}>
                {project.id}
              </Badge>
              <StatusBadge status={status} />
              {port > 0 ? <Badge tone="neutral">端口 {port}</Badge> : null}
            </div>
          </div>

          <div className="wb-banner__actions">
            {pending ? (
              <Button variant="secondary" loading disabled>
                {PENDING_LABEL[status] ?? status}
              </Button>
            ) : status === 'RUNNING' ? (
              <Button
                variant="danger-ghost"
                icon={<Square size={14} aria-hidden="true" />}
                onClick={onStop}
              >
                停止
              </Button>
            ) : (
              // 文案诚实：只负责启动。await 之后 window.open 会被判定为非用户手势而遭拦截（#24）
              <Button
                variant="primary"
                icon={<Play size={14} aria-hidden="true" />}
                onClick={onStart}
              >
                启动
              </Button>
            )}
            <Button
              variant={canOpen ? 'primary' : 'secondary'}
              icon={<ExternalLink size={14} aria-hidden="true" />}
              disabled={!canOpen}
              title={
                canOpen
                  ? `在新标签页打开 ${uiUrl}`
                  : '服务未处于 RUNNING 状态，此时打开会连接被拒绝；请先启动并等待状态变为 RUNNING。'
              }
              onClick={() => {
                if (!canOpen) return;
                window.open(uiUrl, '_blank', 'noopener,noreferrer');
              }}
            >
              打开项目 Web UI
            </Button>
          </div>
        </div>
      </div>

      <div className="wb-tabs" role="tablist" aria-label="项目详情页签">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`detail-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`detail-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={`wb-tab${tab === item.id ? ' wb-tab--active' : ''}`}
            onClick={() => setTab(item.id)}
            onKeyDown={onTabKeyDown}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {status === 'UNHEALTHY' ? (
        <Alert tone="warn">
          上次启动未通过健康检查（进程与端口已回收）。若项目冷启动较慢，请把 manifest 里的
          <code> webUI.healthCheck.timeoutSeconds </code>
          调大后重新登记，或查阅运行日志定位原因。
        </Alert>
      ) : null}

      <div role="tabpanel" id={`detail-panel-${tab}`} aria-labelledby={`detail-tab-${tab}`}>
        {tab === 'readme' ? (
          <Card>
            <CardHead
              title="项目简介"
              desc={
                readme?.found && readme.fileName
                  ? `来源：项目根目录下的 ${readme.fileName}${
                      readme.sizeBytes === undefined ? '' : `（${formatBytes(readme.sizeBytes)}）`
                    }`
                  : '读取项目登记根顶层的自述文件（README.md / readme.md / README.markdown / README.txt）。'
              }
            />
            {readmeLoading ? (
              <p className="wb-muted" style={{ fontSize: 13, margin: 0 }}>
                正在读取自述文件…
              </p>
            ) : readmeError ? (
              <Alert tone="danger">读取失败：{readmeError}</Alert>
            ) : readme?.found ? (
              <>
                {readme.error ? <Alert tone="warn">{readme.error}</Alert> : null}
                <MarkdownView
                  content={readme.content ?? ''}
                  truncated={readme.truncated}
                  fileName={readme.fileName}
                />
              </>
            ) : (
              <EmptyState
                icon={<BookOpen size={28} aria-hidden="true" />}
                title="该项目还没有自述文件"
                desc={
                  <>
                    在项目根目录放置 <code>README.md</code> 后刷新本页即可显示。
                    <br />
                    项目根目录：<code>{project.rootPath}</code>
                  </>
                }
              />
            )}
          </Card>
        ) : null}

        {tab === 'logs' ? (
          <Card>
            <CardHead
              title="运行日志"
              desc="最近一次启动的 stdout / stderr 合并输出。"
              actions={
                <Badge tone="neutral">{logs ? `${logs.split('\n').length} 行` : '空'}</Badge>
              }
            />
            <LogView label="运行日志" emptyText="（暂无日志）" text={logs} />
          </Card>
        ) : null}

        {tab === 'manage' ? (
          <>
            <Card>
              <CardHead
                title="登记信息"
                desc="来自 manifest 快照，修改需重新登记（工作台无 update 端点）。"
              />
              <dl className="wb-kv">
                <div className="wb-kv__row">
                  <dt>项目 ID</dt>
                  <dd>{project.id}</dd>
                </div>
                <div className="wb-kv__row">
                  <dt>根目录</dt>
                  <dd className="wb-mono">{project.rootPath}</dd>
                </div>
                <div className="wb-kv__row">
                  <dt>manifest 哈希</dt>
                  <dd className="wb-mono">{project.manifestHash}</dd>
                </div>
                <div className="wb-kv__row">
                  <dt>登记状态</dt>
                  <dd>{project.status}</dd>
                </div>
                <div className="wb-kv__row">
                  <dt>登记 / 更新</dt>
                  <dd className="wb-mono">
                    {project.createdAt} · {project.updatedAt}
                  </dd>
                </div>
              </dl>
            </Card>

            <Card>
              <CardHead
                title="移除登记"
                desc="仅从工作台移除登记，不会删除磁盘上的项目目录。"
                actions={
                  removeStage === 'idle' ? (
                    <Button
                      variant="danger-ghost"
                      disabled={busy}
                      onClick={() => onRemoveStage('confirm')}
                    >
                      移除登记
                    </Button>
                  ) : null
                }
              />
              {removeStage === 'confirm' ? (
                <div className="wb-row">
                  <Button variant="danger" loading={busy} onClick={() => onRemove(false)}>
                    确认移除登记
                  </Button>
                  <Button disabled={busy} onClick={() => onRemoveStage('idle')}>
                    取消
                  </Button>
                </div>
              ) : null}
              {removeStage === 'force' ? (
                <div className="wb-row">
                  <Alert tone="warn">该项目当前有运行中的服务。确认停止它并移除登记吗？</Alert>
                  <Button variant="danger" loading={busy} onClick={() => onRemove(true)}>
                    停止服务并移除
                  </Button>
                  <Button disabled={busy} onClick={() => onRemoveStage('idle')}>
                    取消
                  </Button>
                </div>
              ) : null}
            </Card>
          </>
        ) : null}
      </div>
    </PageBody>
  );
}
