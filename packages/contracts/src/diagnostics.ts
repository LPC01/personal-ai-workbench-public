/**
 * 统一 Diagnostics（P8-03：一键健康检查）。
 * 类型为纯契约，不含运行时实现。
 */

export type DiagnosticsStatus = 'ok' | 'degraded' | 'down';

export interface DiagnosticsCheck {
  name: string;
  status: DiagnosticsStatus;
  detail: string;
}

export interface DiagnosticsSummary {
  schemaVersion: number;
  projects: number;
  modelProviders: number;
  modelProfiles: number;
  totalRuns: number;
  activeRuns: number;
}

export interface DiagnosticsReport {
  status: DiagnosticsStatus;
  version: string;
  checkedAt: string;
  checks: DiagnosticsCheck[];
  summary: DiagnosticsSummary;
}
