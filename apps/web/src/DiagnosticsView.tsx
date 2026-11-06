import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { getDiagnostics, type DiagnosticsReport } from './api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  PageBody,
  PageHead,
  SkeletonLines,
  Stat,
  StatGrid,
  Table,
  Td,
  Th,
  statusBadgeTone,
} from './ui';
import { useNarrow } from './use-narrow';

const statusText: Record<string, string> = {
  ok: '健康',
  degraded: '降级',
  down: '异常',
};

/** 统一诊断 + 一键健康检查视图（P8-03）。 */
export default function DiagnosticsView() {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const narrow = useNarrow();

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await getDiagnostics());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <PageBody narrow={narrow}>
      <PageHead
        title="Diagnostics · 健康检查"
        desc="聚合数据库、Schema 与 Memory 状态。"
        actions={
          <Button
            variant="primary"
            icon={<RefreshCw size={14} aria-hidden="true" />}
            loading={busy}
            onClick={run}
          >
            {busy ? '检查中…' : '运行健康检查'}
          </Button>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {!report && !error ? (
        <Card>
          <CardHead title="正在检查" desc="首次进入会自动运行一次健康检查。" />
          <SkeletonLines lines={3} />
        </Card>
      ) : null}

      {report ? (
        <>
          <Card>
            <CardHead
              title="整体状态"
              desc={`v${report.version} · ${report.checkedAt}`}
              actions={
                <Badge tone={statusBadgeTone(report.status)}>
                  {statusText[report.status] ?? report.status}
                </Badge>
              }
            />
            <StatGrid>
              <Stat label="Schema 版本" value={report.summary.schemaVersion} />
              <Stat label="项目" value={report.summary.projects} />
              <Stat label="模型 Provider" value={report.summary.modelProviders} />
              <Stat label="模型 Profile" value={report.summary.modelProfiles} />
              <Stat label="Run 总数" value={report.summary.totalRuns} />
              <Stat label="活跃 Run" value={report.summary.activeRuns} />
            </StatGrid>
          </Card>

          <Card>
            <CardHead
              title={`检查项（${report.checks.length}）`}
              desc="状态列同时给出文字与色调，语义不依赖单一颜色。"
            />
            <Table label="诊断检查项">
              <thead>
                <tr>
                  <Th>检查项</Th>
                  <Th>状态</Th>
                  <Th>详情</Th>
                </tr>
              </thead>
              <tbody>
                {report.checks.map((c) => (
                  <tr key={c.name}>
                    <Td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Activity size={14} aria-hidden="true" />
                        <strong style={{ fontWeight: 600 }}>{c.name}</strong>
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={statusBadgeTone(c.status)}>
                        {statusText[c.status] ?? c.status}
                      </Badge>
                    </Td>
                    <Td className="wb-muted">{c.detail}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      ) : null}
    </PageBody>
  );
}
