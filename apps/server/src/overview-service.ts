import type { Project } from '@workbench/project-runtime';
import type { ArtifactStore, RunRecord, RunStore } from '@workbench/persistence';

/** 跨项目摘要。 */
export interface OverviewSummary {
  projects: number;
  runs: { total: number; byStatus: Record<string, number> };
  artifacts: number;
}

/** 活动时间线条目。 */
export interface TimelineEntry {
  kind: 'run' | 'artifact';
  id: string;
  createdAt: string;
  summary: string;
}

export interface GlobalSearchResult {
  projects: Project[];
  runs: RunRecord[];
  artifacts: { id: string; logicalName: string; kind: string }[];
}

/**
 * 概览服务（P8-01）：全局搜索、跨项目摘要、活动时间线。
 * 聚合 ProjectCatalog / RunStore / ArtifactStore。
 */
export class OverviewService {
  constructor(
    private readonly catalog: { list(): Project[] },
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactStore,
  ) {}

  summary(): OverviewSummary {
    const runs = this.runStore.listRuns();
    const byStatus: Record<string, number> = {};
    for (const r of runs) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    }
    return {
      projects: this.catalog.list().length,
      runs: { total: runs.length, byStatus },
      artifacts: this.artifactStore.listAll().length,
    };
  }

  timeline(limit = 50): TimelineEntry[] {
    const runs: TimelineEntry[] = this.runStore.listRuns().map((r) => ({
      kind: 'run',
      id: r.id,
      createdAt: r.createdAt,
      summary: `${r.kind} ${r.status}`,
    }));
    const artifacts: TimelineEntry[] = this.artifactStore.listAll().map((a) => ({
      kind: 'artifact',
      id: a.id,
      createdAt: a.createdAt,
      summary: a.logicalName,
    }));
    return [...runs, ...artifacts]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  search(query: string): GlobalSearchResult {
    const q = query.toLowerCase();
    return {
      projects: this.catalog
        .list()
        .filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)),
      runs: this.runStore
        .listRuns()
        .filter(
          (r) =>
            r.id.toLowerCase().includes(q) ||
            r.kind.toLowerCase().includes(q) ||
            (r.commandRef ?? '').toLowerCase().includes(q),
        ),
      artifacts: this.artifactStore
        .listAll()
        .filter((a) => a.logicalName.toLowerCase().includes(q) || a.kind.toLowerCase().includes(q))
        .map((a) => ({ id: a.id, logicalName: a.logicalName, kind: a.kind })),
    };
  }
}
