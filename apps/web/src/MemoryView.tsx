import { useCallback, useEffect, useState } from 'react';
import { Brain, Plus, RefreshCw, Search } from 'lucide-react';
import {
  activateMemoryCandidate,
  getMemoryHealth,
  importMemoryResource,
  listIssues,
  listMemoryCandidates,
  listMemoryResources,
  listRecallAudits,
  proposeMemoryCandidate,
  recallMemory,
  revokeMemoryCandidate,
  searchMemory,
  supersedeMemoryCandidate,
  verifyMemoryCandidate,
  type Issue,
  type MemoryCandidate,
  type MemoryCenterStatus,
  type MemoryHealth,
  type MemoryHit,
  type MemoryResource,
  type RecallAudit,
} from './api';
import { useNarrow } from './use-narrow';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Field,
  Input,
  PageBody,
  PageHead,
  Select,
  SkeletonLines,
  Textarea,
  type BadgeTone,
} from './ui';

const HEALTH_LABEL: Record<MemoryHealth['status'], string> = {
  UNAVAILABLE: '不可用',
  DEGRADED: '降级运行',
  READY_READONLY: '只读就绪',
  READY_READWRITE: '读写就绪',
};

/** 记忆健康 → 徽章色调（纯函数）。 */
function healthTone(status: MemoryHealth['status']): BadgeTone {
  if (status === 'UNAVAILABLE') return 'danger';
  if (status === 'DEGRADED') return 'warn';
  return 'success';
}

const STATUS_LABEL: Record<MemoryCenterStatus, string> = {
  CANDIDATE: '候选',
  VERIFIED: '已核实',
  ACTIVE: '已生效',
  SUPERSEDED: '已取代',
  REVOKED: '已撤销',
};

/** 候选状态 → 徽章色调（纯函数）。 */
function candidateTone(status: MemoryCenterStatus): BadgeTone {
  if (status === 'ACTIVE') return 'success';
  if (status === 'SUPERSEDED' || status === 'REVOKED') return 'neutral';
  return 'warn';
}

const SENSITIVITY_OPTIONS = ['internal', 'public', 'confidential'] as const;

/**
 * 记忆中心（30 号视觉基线 §3.1 全局导航 MUST；25 设计「记忆中心」子树）。
 *
 * 覆盖：记忆健康 / 资源导入 / 全量 Resources / 语义检索 / 召回审计 /
 * Candidate Inbox（含审核操作）/ Superseded / 已验证经验（Issue→Lesson 投影）。
 *
 * 未覆盖：`Skills`（25 §11.1 定义为「多条经验整理出的稳定范式」，规范未定义生成机制），
 * 已在界面内如实标注，不伪造数据。
 */
export default function MemoryView() {
  const narrow = useNarrow();
  const [health, setHealth] = useState<MemoryHealth | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [sensitivity, setSensitivity] = useState<(typeof SENSITIVITY_OPTIONS)[number]>('internal');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MemoryHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [superseded, setSuperseded] = useState<MemoryCandidate[]>([]);
  const [resources, setResources] = useState<MemoryResource[]>([]);
  const [audits, setAudits] = useState<RecallAudit[]>([]);
  const [draft, setDraft] = useState('');
  const [dataVersion, setDataVersion] = useState(0);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [h, i] = await Promise.all([getMemoryHealth(), listIssues()]);
      setHealth(h);
      setIssues(i.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 挂载即加载：否则首次进入恒为空态（同类缺陷已在 UI-01 修复过）。
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 候选 / 资源 / 审计：按项目隔离加载，并在任何变更后重取。
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listMemoryCandidates({
        projectId: projectId || undefined,
        statuses: ['CANDIDATE', 'VERIFIED', 'ACTIVE'],
      }),
      listMemoryCandidates({ projectId: projectId || undefined, statuses: ['SUPERSEDED'] }),
      listMemoryResources(projectId || undefined),
      listRecallAudits({ projectId: projectId || undefined, limit: 20 }),
    ])
      .then(([inbox, sup, res, audit]) => {
        if (cancelled) return;
        setCandidates(inbox.items);
        setSuperseded(sup.items);
        setResources(res.items);
        setAudits(audit.items);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, dataVersion]);

  async function guarded(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      setDataVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    await guarded(async () => {
      const ref = await importMemoryResource({ projectId, name, content, sensitivity });
      setContent('');
      setNotice(`已导入：${ref.uri}`);
    });
  }

  async function onSearch() {
    setSearching(true);
    setError(null);
    try {
      const r = await searchMemory({ projectId, query, limit: 5 });
      setHits(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHits(null);
    } finally {
      setSearching(false);
    }
  }

  async function onRecall() {
    setSearching(true);
    setError(null);
    try {
      const r = await recallMemory({ projectId, query, budgetTokens: 2048 });
      setHits(r.hits);
      setDataVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHits(null);
    } finally {
      setSearching(false);
    }
  }

  const lessons = issues.filter((i) => i.status === 'LESSON');
  const verified = issues.filter((i) => i.status === 'VERIFIED');

  return (
    <PageBody narrow={narrow}>
      <PageHead
        title="记忆中心"
        desc="候选审核 · 资源 · 检索与召回审计 · 经验沉淀（25 设计「记忆中心」；26 SPEC §14）"
        actions={
          <Button icon={<RefreshCw size={14} aria-hidden="true" />} onClick={refresh}>
            刷新
          </Button>
        }
      />

      {notice ? (
        <Alert tone="success" className="wb-alert--notice">
          <span data-testid="import-notice">{notice}</span>
        </Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardHead
          title="记忆健康"
          desc={health?.detail ?? '读取 Memory Provider 的健康状态。'}
          actions={
            health ? (
              <Badge tone={healthTone(health.status)} className="wb-health-badge">
                <span data-testid="health-status">
                  {HEALTH_LABEL[health.status]} · {health.status}
                </span>
              </Badge>
            ) : (
              <Badge tone="neutral">加载中…</Badge>
            )
          }
        />
        {!health && !error ? <SkeletonLines lines={1} /> : null}
      </Card>

      <Card>
        <CardHead title="项目范围" desc="下列资源 / 候选 / 审计均按此项目隔离。" />
        <Field label="项目 ID" hint="留空表示跨项目。">
          <Input
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="demo-mem"
            style={{ maxWidth: 240 }}
          />
        </Field>
      </Card>

      <Card>
        <CardHead title="资源导入（只读）" desc="原文不被修改，仅建立索引。" />
        <div className="wb-row" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 160 }}>
            <Field label="资源名称">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="intro"
                aria-label="资源名称"
              />
            </Field>
          </div>
          <div style={{ minWidth: 150 }}>
            <Field label="敏感级别">
              <Select
                value={sensitivity}
                onChange={(e) =>
                  setSensitivity(e.target.value as (typeof SENSITIVITY_OPTIONS)[number])
                }
                aria-label="敏感级别"
              >
                {SENSITIVITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={busy || !projectId || !name || !content}
            onClick={onImport}
          >
            导入
          </Button>
        </div>
        <div style={{ marginTop: 'var(--wb-space-3)' }}>
          <Field label="内容" hint="markdown / 纯文本。">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              placeholder="以纯文本粘贴要建立索引的资源内容…"
              aria-label="资源内容"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHead
          title={`资源（${resources.length}${projectId ? ` · 项目 ${projectId}` : ' · 全部项目'}）`}
        />
        {resources.length === 0 ? (
          <EmptyState title="暂无资源" desc="导入资源后出现在此（跨项目默认隔离）。" />
        ) : (
          <ul className="wb-entity-list" data-testid="resources-list">
            {resources.map((r) => (
              <li key={r.uri} className="wb-entity">
                <div className="wb-uri">{r.uri}</div>
                <div className="wb-muted">
                  {r.sensitivity} · 项目 {r.projectId}
                  {r.sourceHash ? ` · ${r.sourceHash.slice(0, 12)}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead title="语义检索与召回" desc="检索不写审计；召回按 token 预算裁剪并写入审计。" />
        <div className="wb-row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <Field label="查询">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="用自然语言描述你要找的内容…"
                aria-label="检索查询"
              />
            </Field>
          </div>
          <Button
            icon={<Search size={14} aria-hidden="true" />}
            loading={searching}
            disabled={!projectId || !query}
            onClick={onSearch}
          >
            检索
          </Button>
          <Button
            disabled={searching || !projectId || !query}
            title="按 token 预算裁剪召回，并写入一条召回审计"
            onClick={onRecall}
          >
            召回（写审计）
          </Button>
        </div>

        {hits !== null ? (
          <div data-testid="search-results" style={{ marginTop: 'var(--wb-space-4)' }}>
            <p className="wb-muted" style={{ fontSize: 12, margin: '0 0 var(--wb-space-2)' }}>
              命中 {hits.length} 条（项目 {projectId}，已排除 superseded/revoked）
            </p>
            {hits.length === 0 ? (
              <EmptyState title="无命中" desc="确认项目 ID 正确、且已导入该项目的资源。" />
            ) : (
              <ul className="wb-entity-list">
                {hits.map((h) => (
                  <li key={h.uri} className="wb-entity">
                    <div className="wb-row" style={{ gap: 8 }}>
                      <span className="wb-score">{h.score.toFixed(4)}</span>
                      <span className="wb-uri">{h.uri}</span>
                    </div>
                    {h.snippet ? <div className="wb-muted">{h.snippet}</div> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHead title={`检索与召回审计（${audits.length}）`} />
        {audits.length === 0 ? (
          <EmptyState title="暂无审计记录" desc="点「召回（写审计）」后会在此留下记录。" />
        ) : (
          <ul className="wb-entity-list" data-testid="recall-audit">
            {audits.map((a) => (
              <li key={a.id} className="wb-entity">
                <div className="wb-row" style={{ gap: 8 }}>
                  <strong style={{ fontWeight: 600 }}>{a.query}</strong>
                  <span className="wb-muted">
                    {a.scope} · 命中 {a.hitUris.length} · {a.totalTokens}/{a.budgetTokens} tokens ·
                    注入 {a.injectedPosition}
                  </span>
                </div>
                {a.hitUris.length > 0 ? (
                  <div className="wb-uri wb-muted">{a.hitUris.join(' · ')}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead
          title={`Candidate Inbox（在办 ${candidates.length}）`}
          desc="模型产物只能进入「候选」；必须核实（VERIFIED）后才能生效（ACTIVE）。Secret/PII 会被拒绝。"
        />
        <div className="wb-row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <Field label="新增候选">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="新增候选内容（如一条经验）…"
                aria-label="候选内容"
              />
            </Field>
          </div>
          <Button
            variant="primary"
            icon={<Plus size={14} aria-hidden="true" />}
            disabled={busy || !draft}
            onClick={() =>
              void guarded(async () => {
                await proposeMemoryCandidate({ content: draft, projectId: projectId || undefined });
                setDraft('');
              }, '已加入候选')
            }
          >
            提议候选
          </Button>
        </div>

        <div style={{ marginTop: 'var(--wb-space-4)' }}>
          {candidates.length === 0 ? (
            <EmptyState title="暂无候选" desc="用上方输入框提议，或在「Issue」中晋升 Lesson。" />
          ) : (
            <ul className="wb-entity-list" data-testid="candidate-inbox">
              {candidates.map((c) => (
                <li key={c.uri} className="wb-entity">
                  <div className="wb-row" style={{ gap: 8 }}>
                    <Badge tone={candidateTone(c.status)}>
                      {STATUS_LABEL[c.status]} · {c.status}
                    </Badge>
                    <span className="wb-uri" style={{ flex: '1 1 160px', minWidth: 0 }}>
                      {c.uri}
                    </span>
                    <span className="wb-row" style={{ gap: 6 }}>
                      {c.status === 'CANDIDATE' ? (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => void guarded(() => verifyMemoryCandidate(c.uri), '已核实')}
                        >
                          核实
                        </Button>
                      ) : null}
                      {c.status === 'VERIFIED' ? (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void guarded(() => activateMemoryCandidate(c.uri), '已生效')
                          }
                        >
                          生效
                        </Button>
                      ) : null}
                      {c.status === 'CANDIDATE' || c.status === 'VERIFIED' ? (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void guarded(() => supersedeMemoryCandidate(c.uri), '已取代')
                          }
                        >
                          取代
                        </Button>
                      ) : null}
                      {c.status === 'ACTIVE' ? (
                        <Button
                          size="sm"
                          variant="danger-ghost"
                          disabled={busy}
                          onClick={() => void guarded(() => revokeMemoryCandidate(c.uri), '已撤销')}
                        >
                          撤销
                        </Button>
                      ) : null}
                    </span>
                  </div>
                  <div className="wb-muted">{c.content}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHead title={`Superseded（已取代 ${superseded.length}）`} />
        {superseded.length === 0 ? (
          <EmptyState title="暂无被取代的记忆" />
        ) : (
          <ul className="wb-entity-list" data-testid="superseded">
            {superseded.map((c) => (
              <li key={c.uri} className="wb-entity">
                <Badge tone="neutral">SUPERSEDED</Badge> <span className="wb-uri">{c.uri}</span>
                {c.supersededBy ? (
                  <span className="wb-muted"> → 由 {c.supersededBy} 取代</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead
          title="已验证经验（Issue → Lesson 闭环投影）"
          desc={`已沉淀 Lesson ${lessons.length} 条 · 已验证待沉淀 ${verified.length} 条`}
        />
        <div data-testid="lessons">
          {lessons.length + verified.length === 0 ? (
            <EmptyState
              title="暂无已验证经验"
              desc="在「Issue」中走完 解决 → 验证 后即出现在此。"
            />
          ) : (
            <ul className="wb-entity-list">
              {[...lessons, ...verified].map((i) => (
                <li key={i.id} className="wb-entity">
                  <Badge tone={i.status === 'LESSON' ? 'success' : 'info'}>{i.status}</Badge>{' '}
                  <span>{i.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHead title="Skills（Pattern / Skill）" />
        <EmptyState
          icon={<Brain size={28} aria-hidden="true" />}
          title="未实现"
          desc="25 设计 §11.1 将 Pattern/Skill 定义为「多条经验整理出的稳定范式」，但规范未定义其生成机制（无派生规则、无审批流），故不伪造条目；待规范明确后单独实现。"
        />
      </Card>
    </PageBody>
  );
}
