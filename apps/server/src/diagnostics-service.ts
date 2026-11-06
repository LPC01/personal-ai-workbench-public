import type Database from 'better-sqlite3';
import type { DiagnosticsCheck, DiagnosticsReport, DiagnosticsStatus } from '@workbench/contracts';
import type { Migration, ModelGatewayStore, RunStore } from '@workbench/persistence';
import type { ProjectCatalog } from '@workbench/project-runtime';
import { isTerminalRunStatus } from '@workbench/domain';

/** 工作台版本。 */
export const WORKBENCH_VERSION = '0.1.0';

/** 统一诊断服务（P8-03）：一键健康检查聚合 database / schema / memory。 */
export class DiagnosticsService {
  constructor(
    private readonly db: Database.Database,
    private readonly catalog: ProjectCatalog,
    private readonly runStore: RunStore,
    private readonly modelStore: ModelGatewayStore,
    private readonly migrations: Migration[],
  ) {}

  run(): DiagnosticsReport {
    const checks: DiagnosticsCheck[] = [
      this.checkDatabase(),
      this.checkSchema(),
      this.checkMemory(),
    ];

    const status = aggregateStatus(checks.map((c) => c.status));
    const runs = this.runStore.listRuns();
    const applied = this.appliedVersions();

    return {
      status,
      version: WORKBENCH_VERSION,
      checkedAt: new Date().toISOString(),
      checks,
      summary: {
        schemaVersion: Math.max(0, ...applied),
        projects: this.catalog.list().length,
        modelProviders: this.modelStore.listProviders().length,
        modelProfiles: this.modelStore.listProfiles().length,
        totalRuns: runs.length,
        activeRuns: runs.filter((r) => !isTerminalRunStatus(r.status)).length,
      },
    };
  }

  private appliedVersions(): number[] {
    try {
      const rows = this.db.prepare('SELECT version FROM schema_migrations').all() as {
        version: number;
      }[];
      return rows.map((r) => r.version);
    } catch {
      return [];
    }
  }

  private checkDatabase(): DiagnosticsCheck {
    try {
      this.db.prepare('SELECT 1').get();
      return { name: 'database', status: 'ok', detail: 'SQLite 连接正常' };
    } catch (err) {
      return { name: 'database', status: 'down', detail: messageOf(err) };
    }
  }

  private checkSchema(): DiagnosticsCheck {
    const maxVersion = Math.max(0, ...this.migrations.map((m) => m.version));
    const applied = Math.max(0, ...this.appliedVersions());
    if (maxVersion === 0) {
      return { name: 'schema', status: 'ok', detail: '无待应用 migration' };
    }
    if (applied >= maxVersion) {
      return { name: 'schema', status: 'ok', detail: `schema 版本 ${applied}/${maxVersion}` };
    }
    return {
      name: 'schema',
      status: 'degraded',
      detail: `schema 版本落后：${applied}/${maxVersion}`,
    };
  }

  private checkMemory(): DiagnosticsCheck {
    // Memory 首期为 InMemory 降级实现，始终可用。
    return { name: 'memory', status: 'ok', detail: 'InMemory MemoryProvider 可用' };
  }
}

function aggregateStatus(statuses: DiagnosticsStatus[]): DiagnosticsStatus {
  if (statuses.includes('down')) return 'down';
  if (statuses.includes('degraded')) return 'degraded';
  return 'ok';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
