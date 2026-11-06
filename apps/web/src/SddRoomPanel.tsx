import { useCallback, useEffect, useState } from 'react';
import {
  SDD_STAGES,
  advanceSddStage,
  decideApproval,
  getSddStage,
  listApprovals,
  type Approval,
  type SddStage,
} from './api';
import { Alert, Badge, Button, Card, CardHead, cx } from './ui';

const STAGE_LABELS: Record<SddStage, string> = {
  INTAKE: '需求录入',
  SPEC_DRAFT: '规格草案',
  SPEC_REVIEW: '规格评审',
  WAITING_SPEC_APPROVAL: '待批准',
  IMPLEMENTATION: '实现',
  VERIFICATION: '验证',
  INDEPENDENT_REVIEW: '独立评审',
  DECISION: '决策',
  ARCHIVE: '归档',
};

/** 推进到下一阶段所需的门禁上下文（按当前阶段决定）。 */
function gateFor(stage: SddStage) {
  if (stage === 'INDEPENDENT_REVIEW') {
    return { specApproved: true, reviewDecision: 'ACCEPTED' as const, hasFinalArtifact: true };
  }
  return { specApproved: true, hasFinalArtifact: true };
}

/**
 * SDD 交付面板（29 号 SPEC §14 + 30 号基线：阶段条 + 人工审批门）。
 * 「当前裁决」由右栏侧栏呈现（30 号 MUST：裁决属于侧栏信息），本组件通过
 * `onDecided` 通知父组件刷新，保证批准后裁决立即出现。
 */
export default function SddRoomPanel({
  runId,
  onDecided,
  refreshToken,
}: {
  runId: string;
  onDecided?: () => void;
  /** 父组件刷新运行数据时递增，用于同步重载审批列表（避免新建审批后不可见）。 */
  refreshToken?: number;
}) {
  const [stage, setStage] = useState<SddStage>('INTAKE');
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([getSddStage(runId), listApprovals()]);
      setStage(s.stage);
      setApprovals(a.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [runId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  async function onAdvance() {
    setBusy(true);
    setError(null);
    try {
      const r = await advanceSddStage(runId, gateFor(stage));
      setStage(r.stage);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDecide(id: string, approved: boolean) {
    setBusy(true);
    setError(null);
    try {
      await decideApproval(id, approved);
      await refresh();
      onDecided?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const currentIdx = SDD_STAGES.indexOf(stage);
  const pending = approvals.filter((a) => a.status === 'PENDING');
  const nextStage = currentIdx < SDD_STAGES.length - 1 ? SDD_STAGES[currentIdx + 1] : null;

  return (
    <Card>
      <CardHead
        title="SDD 交付阶段"
        desc="阶段推进受门禁约束，审批由人工裁决。"
        actions={<Badge tone="info">{STAGE_LABELS[stage]}</Badge>}
      />

      <div className="wb-steps">
        {SDD_STAGES.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div key={s} className="wb-row" style={{ gap: 4 }}>
              <span
                title={s}
                className={cx(
                  'wb-step',
                  done && 'wb-step--done',
                  active && 'wb-step--active',
                  !done && !active && 'wb-step--todo',
                )}
              >
                {done ? '✓ ' : ''}
                {STAGE_LABELS[s]}
              </span>
              {i < SDD_STAGES.length - 1 ? <span className="wb-step-sep">·</span> : null}
            </div>
          );
        })}
      </div>

      {nextStage ? (
        <div style={{ marginTop: 'var(--wb-space-3)' }}>
          <Button variant="primary" size="sm" loading={busy} onClick={onAdvance}>
            {stage === 'WAITING_SPEC_APPROVAL'
              ? '批准 Spec 并进入实现'
              : stage === 'INDEPENDENT_REVIEW'
                ? '评审通过（ACCEPTED）'
                : `推进到 ${STAGE_LABELS[nextStage]}`}
          </Button>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <Alert tone="warn" className="wb-side__note">
          <div style={{ width: '100%' }}>
            <strong style={{ fontSize: 12 }}>待人工审批（{pending.length}）</strong>
            <ul className="wb-entity-list" style={{ marginTop: 6 }}>
              {pending.map((a) => (
                <li key={a.id} className="wb-entity">
                  <div className="wb-row" style={{ gap: 8 }}>
                    <span className="wb-uri">
                      {a.actionType} · {a.targetRef}
                    </span>
                    <span className="wb-spacer" />
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy}
                      onClick={() => onDecide(a.id, true)}
                    >
                      批准
                    </Button>
                    <Button
                      size="sm"
                      variant="danger-ghost"
                      disabled={busy}
                      onClick={() => onDecide(a.id, false)}
                    >
                      拒绝
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="danger" className="wb-side__note">
          {error}
        </Alert>
      ) : null}
    </Card>
  );
}
