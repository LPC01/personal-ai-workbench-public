import { useEffect, useState } from 'react';
import { BookOpen, FolderOpen, FolderPlus } from 'lucide-react';
import { avatarHue, avatarInitial } from './avatar';
import { getReadme, getRuntime, type Project } from './api';
import { Badge, Button, EmptyState, PageBody, PageHead, Stat, StatGrid, StatusBadge } from './ui';

/**
 * 「已有项目」的卡片网格（PROJ-UI-01）。
 *
 * 布局参考 GitHub 热门项目的仪表盘式列表：卡片网格承载项目，点击进入详情页。
 * 统计条**只显示工作台确有数据源的三项**（已登记 / 运行中 / 有 README）——
 * 「平均进度」「完成率」一类指标本机没有数据来源，不做假指标。
 *
 * 卡片的运行状态与 README 存在性需要按项目并发探测（列表接口不含这两项）。
 * 探测失败不影响主流程：状态回落 `STOPPED`、README 回落「未探测到」。
 */
export interface ProjectGridProps {
  projects: Project[];
  onOpen: (project: Project) => void;
  onRegister: () => void;
  narrow: boolean;
}

interface ProjectFacts {
  /** 运行时状态；探测失败回落 STOPPED（与服务端「无服务实例」一致）。 */
  status: string;
  port: number;
  hasReadme: boolean;
}

export function ProjectGrid({ projects, onOpen, onRegister, narrow }: ProjectGridProps) {
  const [facts, setFacts] = useState<Record<string, ProjectFacts>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        projects.map(async (project) => {
          const [runtime, readme] = await Promise.all([
            getRuntime(project.id).catch(() => null),
            getReadme(project.id, true).catch(() => null),
          ]);
          const status = (runtime as { status?: string } | null)?.status ?? 'STOPPED';
          const port = (runtime as { port?: number } | null)?.port ?? 0;
          return [project.id, { status, port, hasReadme: readme?.found === true }] as const;
        }),
      );
      if (cancelled) return;
      setFacts(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const running = projects.filter((p) => facts[p.id]?.status === 'RUNNING').length;
  const withReadme = projects.filter((p) => facts[p.id]?.hasReadme).length;

  return (
    <PageBody narrow={narrow}>
      <PageHead
        title="已有项目"
        desc="工作台不扫描磁盘：下列项目均通过 manifest 登记。点卡片查看简介、运行日志与管理操作。"
        actions={
          <Button
            variant="primary"
            icon={<FolderPlus size={14} aria-hidden="true" />}
            onClick={onRegister}
          >
            登记新项目
          </Button>
        }
      />

      <StatGrid>
        <Stat label="已登记" value={projects.length} hint="manifest 登记总数" />
        <Stat label="运行中" value={running} hint="运行时状态为 RUNNING" />
        <Stat label="有 README" value={withReadme} hint="登记根顶层探测到自述文件" />
      </StatGrid>

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={28} aria-hidden="true" />}
          title="还没有登记任何项目"
          desc="登记一份 workbench.project/v1 manifest 即可把它接入工作台。"
          action={
            <Button variant="primary" onClick={onRegister}>
              登记新项目
            </Button>
          }
        />
      ) : (
        <ul className="wb-pgrid" aria-label="已登记项目">
          {projects.map((project) => {
            const fact = facts[project.id];
            const hue = avatarHue(project.id);
            const described = (project.description ?? '').trim().length > 0;
            return (
              <li key={project.id}>
                <button
                  type="button"
                  className="wb-pcard"
                  onClick={() => onOpen(project)}
                  aria-label={`打开项目 ${project.name}`}
                >
                  <div className="wb-pcard__head">
                    <span
                      className="wb-avatar"
                      style={{ background: `hsl(${hue} 62% 42%)` }}
                      aria-hidden="true"
                    >
                      {avatarInitial(project.name)}
                    </span>
                    <div className="wb-pcard__title">
                      <span className="wb-pcard__name">{project.name}</span>
                      <span className="wb-pcard__id">{project.id}</span>
                    </div>
                  </div>

                  {described ? (
                    <p className="wb-pcard__desc">{project.description}</p>
                  ) : (
                    <p className="wb-pcard__desc wb-pcard__desc--empty">
                      <span className="wb-muted">无简介 · </span>
                      {project.rootPath}
                    </p>
                  )}

                  <div className="wb-pcard__foot">
                    <StatusBadge status={fact?.status ?? 'STOPPED'} />
                    {fact?.port ? <Badge tone="neutral">端口 {fact.port}</Badge> : null}
                    {fact?.hasReadme ? (
                      <Badge tone="neutral" icon={<BookOpen size={11} aria-hidden="true" />}>
                        README
                      </Badge>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}
