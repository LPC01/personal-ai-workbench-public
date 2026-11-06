import { useEffect, useRef, useState } from 'react';
import { ListChecks } from 'lucide-react';
import {
  getRun,
  listRunArtifacts,
  listRunEvents,
  listRuns,
  type Artifact,
  type Run,
  type RunEvent,
} from './api';
import { useNarrow } from './use-narrow';
import {
  Alert,
  Badge,
  Card,
  CardHead,
  EmptyState,
  LogView,
  PageBody,
  PageHead,
  StatusBadge,
  Table,
  Td,
  Th,
} from './ui';

export default function RunsView() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 窄屏（≤900px）：运行列表折叠为可展开区块（30 号 §5 移动降级）
  const narrow = useNarrow();
  const listPanelRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    listRuns()
      .then((r) => setRuns(r.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selected) return;
    getRun(selected.id)
      .then(setSelected)
      .catch(() => {});
    listRunEvents(selected.id)
      .then((r) => setEvents(r.items))
      .catch(() => setEvents([]));
    listRunArtifacts(selected.id)
      .then((r) => setArtifacts(r.items))
      .catch(() => setArtifacts([]));
  }, [selected?.id]);

  // 运行列表：宽屏固定在左侧列，窄屏折叠进 <details>（30 号 §5）
  const runList = (
    <ul className="wb-list">
      {runs.map((r) => (
        <li key={r.id}>
          <button
            onClick={() => {
              setSelected(r);
              listPanelRef.current?.removeAttribute('open');
            }}
            className={`wb-list__item${selected?.id === r.id ? ' wb-list__item--active' : ''}`}
          >
            <span className="wb-list__title wb-mono">{r.id}</span>
            <span className="wb-list__sub">
              {r.kind} · {r.status}
            </span>
          </button>
        </li>
      ))}
    </ul>
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
        <details ref={listPanelRef} className="wb-side__narrow">
          <summary className="wb-side__summary">运行列表（{runs.length}）</summary>
          <div style={{ padding: 'var(--wb-space-3)' }}>{runList}</div>
        </details>
      ) : (
        <aside className="wb-panel-col">
          <h2 className="wb-side__title">运行（{runs.length}）</h2>
          {runList}
        </aside>
      )}

      <PageBody narrow={narrow}>
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {!selected ? (
          <Card>
            <EmptyState
              icon={<ListChecks size={28} aria-hidden="true" />}
              title="未选择运行"
              desc="从左侧列表选择一个运行，查看它的事件日志与成果。"
            />
          </Card>
        ) : (
          <>
            <PageHead
              title={<span className="wb-mono">{selected.id}</span>}
              desc={
                <span>
                  类型 {selected.kind} · 项目 {selected.projectId ?? '—'} · 状态{' '}
                  <StatusBadge status={selected.status} />
                  {selected.exitCode !== null ? ` · 退出码 ${selected.exitCode}` : ''}
                  {selected.errorCode ? ` · ${selected.errorCode}` : ''}
                </span>
              }
            />

            <Card>
              <CardHead
                title="事件日志"
                desc="按 sequence 顺序回放，payload 为原始 JSON。"
                actions={<Badge tone="neutral">{events.length} 条</Badge>}
              />
              <LogView
                label="运行事件日志"
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

            <Card>
              <CardHead title="成果（Artifact）" />
              {artifacts.length === 0 ? (
                <EmptyState title="暂无成果" desc="该运行尚未产出可下载的 Artifact。" />
              ) : (
                <Table label="运行成果">
                  <thead>
                    <tr>
                      <Th>名称</Th>
                      <Th numeric>大小（B）</Th>
                      <Th>SHA256</Th>
                      <Th>操作</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {artifacts.map((a) => (
                      <tr key={a.id}>
                        <Td>{a.logicalName}</Td>
                        <Td numeric>{a.sizeBytes}</Td>
                        <Td className="wb-mono">{a.sha256.slice(0, 12)}</Td>
                        <Td>
                          <a href={`/api/v1/artifacts/${a.id}`} className="wb-link">
                            下载
                          </a>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </>
        )}
      </PageBody>
    </div>
  );
}
