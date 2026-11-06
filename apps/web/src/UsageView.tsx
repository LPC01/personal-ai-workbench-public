import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  getUsageByDay,
  getUsageByModel,
  getUsageOverview,
  type ModelUsageByDay,
  type ModelUsageByModel,
  type ModelUsageOverview,
} from './api';
import { useNarrow } from './use-narrow';
import {
  Alert,
  Button,
  Card,
  CardHead,
  EmptyState,
  PageBody,
  PageHead,
  SkeletonLines,
  Stat,
  StatGrid,
  Table,
  Td,
  Th,
} from './ui';

const fmtCost = (n: number) => `¥${n.toFixed(4)}`;

/** 模型使用量/延迟/成本视图（P8-02）。 */
export default function UsageView() {
  const [overview, setOverview] = useState<ModelUsageOverview | null>(null);
  const [byModel, setByModel] = useState<ModelUsageByModel[]>([]);
  const [byDay, setByDay] = useState<ModelUsageByDay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const narrow = useNarrow();

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [ov, bm, bd] = await Promise.all([
        getUsageOverview(),
        getUsageByModel(),
        getUsageByDay(),
      ]);
      setOverview(ov);
      setByModel(bm);
      setByDay(bd);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const maxDayCalls = Math.max(1, ...byDay.map((d) => d.calls));

  return (
    <PageBody narrow={narrow}>
      <PageHead
        title="模型用量"
        desc="按模型与按天聚合的 token、延迟与成本。"
        actions={
          <Button icon={<RefreshCw size={14} aria-hidden="true" />} onClick={refresh}>
            刷新
          </Button>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading && !overview ? (
        <Card>
          <CardHead title="总览" desc="正在读取用量统计。" />
          <SkeletonLines lines={2} />
        </Card>
      ) : null}

      {overview ? (
        <Card>
          <CardHead title="总览" desc="统计口径为已记录的调用事件。" />
          <StatGrid>
            <Stat label="调用次数" value={overview.totalCalls} />
            <Stat label="输入 tokens" value={overview.totalPromptTokens} />
            <Stat label="输出 tokens" value={overview.totalCompletionTokens} />
            <Stat label="平均延迟" value={`${overview.avgLatencyMs} ms`} />
            <Stat label="总成本" value={fmtCost(overview.totalCost)} />
          </StatGrid>
        </Card>
      ) : null}

      <Card>
        <CardHead title="按模型" />
        {byModel.length === 0 ? (
          <EmptyState title="暂无按模型数据" desc="产生模型调用后，这里会按模型维度聚合。" />
        ) : (
          <Table label="按模型用量">
            <thead>
              <tr>
                <Th>模型</Th>
                <Th numeric>调用</Th>
                <Th numeric>输入 tokens</Th>
                <Th numeric>输出 tokens</Th>
                <Th numeric>平均延迟</Th>
                <Th numeric>成本</Th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((m) => (
                <tr key={m.modelId}>
                  <Td>{m.modelId}</Td>
                  <Td numeric>{m.calls}</Td>
                  <Td numeric>{m.promptTokens}</Td>
                  <Td numeric>{m.completionTokens}</Td>
                  <Td numeric>{m.avgLatencyMs} ms</Td>
                  <Td numeric>{fmtCost(m.totalCost)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHead title="按天" desc="分布列为相对最大值的比例条（不引入图表库）。" />
        {loading && byDay.length === 0 && !error ? <SkeletonLines lines={2} /> : null}
        {!loading && byDay.length === 0 ? (
          <EmptyState title="暂无按天数据" desc="产生模型调用后，这里会按天聚合。" />
        ) : (
          <Table label="按天用量">
            <thead>
              <tr>
                <Th>日期</Th>
                <Th numeric>调用</Th>
                <Th numeric>输入 tokens</Th>
                <Th numeric>输出 tokens</Th>
                <Th numeric>成本</Th>
                <Th>分布</Th>
              </tr>
            </thead>
            <tbody>
              {byDay.map((d) => (
                <tr key={d.day}>
                  <Td>{d.day}</Td>
                  <Td numeric>{d.calls}</Td>
                  <Td numeric>{d.promptTokens}</Td>
                  <Td numeric>{d.completionTokens}</Td>
                  <Td numeric>{fmtCost(d.totalCost)}</Td>
                  <Td>
                    <div
                      className="wb-bar"
                      role="img"
                      aria-label={`调用 ${d.calls} 次，占峰值 ${Math.round((d.calls / maxDayCalls) * 100)}%`}
                    >
                      <div
                        className="wb-bar__fill"
                        style={{ width: `${(d.calls / maxDayCalls) * 100}%` }}
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageBody>
  );
}
