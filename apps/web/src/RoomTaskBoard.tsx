import { useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { createWorkItem, handoffWorkItem, updateWorkItem, type RoomWorkItem } from './api';
import { WORK_ITEM_STATUSES, WORK_ITEM_STATUS_LABELS } from './room-run';
import { Alert, Badge, Button, Card, CardHead, Field, Input, Select } from './ui';

/**
 * 共享任务板（UI-10）：状态流转 + Handoff 交接。
 *
 * 与 OpenHands 的做法不同点：本工作台的 WorkItem 是**有存储的实体**（room_work_items），
 * 不是从事件里派生的快照，所以这里直接调用后端状态流转端点，而不是让 LLM 用 tool 改。
 */
export default function RoomTaskBoard({
  runId,
  items,
  participants,
  onChanged,
}: {
  runId: string;
  items: RoomWorkItem[];
  participants: string[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handoffFor, setHandoffFor] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [objective, setObjective] = useState('');
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState('');

  async function addItem(): Promise<void> {
    if (!kind.trim()) return;
    setError(null);
    try {
      await createWorkItem(runId, { kind: kind.trim() });
      setKind('');
      setAdding(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function changeStatus(item: RoomWorkItem, status: string): Promise<void> {
    setBusyId(item.id);
    setError(null);
    try {
      await updateWorkItem(runId, item.id, { status });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function submitHandoff(item: RoomWorkItem): Promise<void> {
    setBusyId(item.id);
    setError(null);
    try {
      await handoffWorkItem(runId, {
        handoff: {
          toParticipantId: to,
          workItemId: item.id,
          objective: objective.trim() || `交接：${item.kind}`,
          inputRefs: item.inputRefs,
          acceptance: [],
          reason: '由协作控制台发起的交接',
        },
        allowedParticipants: participants,
      });
      setHandoffFor(null);
      setTo('');
      setObjective('');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHead
        title={`共享任务板（${items.length}）`}
        desc="状态流转与交接都会写成事实事件。"
        actions={
          <Button
            size="sm"
            icon={<Plus size={13} aria-hidden="true" />}
            onClick={() => setAdding(true)}
          >
            加任务
          </Button>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {adding ? (
        <div className="wb-row" style={{ gap: 6, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Field label="任务 kind">
              <Input
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                placeholder="implement-login"
                aria-label="任务 kind"
              />
            </Field>
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={!kind.trim()}
            onClick={() => void addItem()}
          >
            添加
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="wb-muted" style={{ fontSize: 12 }}>
          暂无任务条目。
        </p>
      ) : (
        <ul className="wb-entity-list">
          {items.map((w) => (
            <li key={w.id} className="wb-entity">
              <div className="wb-row" style={{ gap: 6 }}>
                <strong style={{ fontSize: 12, fontWeight: 600 }}>{w.kind}</strong>
                <Badge tone={w.status === 'ACCEPTED' ? 'success' : 'neutral'}>
                  {WORK_ITEM_STATUS_LABELS[w.status] ?? w.status}
                </Badge>
                <span className="wb-spacer" />
                <span className="wb-muted" style={{ fontSize: 11 }}>
                  {w.assigneeRef ?? '未指派'}
                </span>
              </div>

              <div className="wb-row" style={{ gap: 6, marginTop: 6 }}>
                <Select
                  value={w.status}
                  disabled={busyId === w.id}
                  onChange={(e) => void changeStatus(w, e.target.value)}
                  aria-label={`任务 ${w.kind} 状态`}
                >
                  {WORK_ITEM_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {WORK_ITEM_STATUS_LABELS[s] ?? s}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  icon={<ArrowRight size={13} aria-hidden="true" />}
                  onClick={() => setHandoffFor(handoffFor === w.id ? null : w.id)}
                >
                  交接
                </Button>
              </div>

              {handoffFor === w.id ? (
                <div className="wb-col" style={{ marginTop: 6 }}>
                  <Field label="交接给">
                    <Select
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      aria-label={`交接目标 ${w.kind}`}
                    >
                      <option value="">（选择参与者）</option>
                      {participants.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="目标说明">
                    <Input
                      value={objective}
                      onChange={(e) => setObjective(e.target.value)}
                      placeholder="请完成接口设计"
                      aria-label={`交接目标说明 ${w.kind}`}
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!to || busyId === w.id}
                    onClick={() => void submitHandoff(w)}
                  >
                    提交交接
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
