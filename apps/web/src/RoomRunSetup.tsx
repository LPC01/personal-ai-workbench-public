import { useMemo, useState } from 'react';
import { Plus, Trash } from 'lucide-react';
import {
  startOrchestration,
  type HarnessProfile,
  type ModelProfile,
  type ParticipantInput,
} from './api';
import { HARNESS_TOOL_IDS, parseParticipantsJson, stringifyParticipants } from './room-run';
import { Alert, Badge, Button, Card, CardHead, Field, Input, Select, Textarea, cx } from './ui';

interface Draft extends ParticipantInput {
  /** 表单内部用的稳定 key（participantId 可改）。 */
  key: string;
}

function newDraft(index: number): Draft {
  return {
    key: `draft-${index}-${Math.random().toString(36).slice(2, 8)}`,
    participantId: '',
    systemInstruction: '',
    harnessProfileId: '',
    modelBinding: { modelProfileId: '', revision: 1 },
    toolPolicy: { allowedTools: [] },
  };
}

const DEFAULT_LIMITS = {
  maxTurns: 20,
  maxDurationSeconds: 3600,
  maxTotalTokens: 200000,
  maxCost: 10,
  noProgressTurns: 3,
};

/**
 * 编排启动面板（UI-10）：配置参与者 / 协议预算 / 初始任务，然后 `orchestrate/start`。
 *
 * 配置模型借鉴 AutoGen Studio（表单 ⇄ JSON 双模）：表单为主，JSON 为带校验的第二入口，
 * 解析失败只在高级区报错，不影响表单继续编辑。
 */
export default function RoomRunSetup({
  runId,
  modelProfiles,
  harnessProfiles,
  onStarted,
}: {
  runId: string;
  modelProfiles: ModelProfile[];
  harnessProfiles: HarnessProfile[];
  onStarted: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([newDraft(0), newDraft(1)]);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [workItemKind, setWorkItemKind] = useState('');
  const [workItems, setWorkItems] = useState<{ kind: string; assigneeRef: string | null }[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const jsonResult = useMemo(
    () => (advanced ? parseParticipantsJson(jsonText) : null),
    [advanced, jsonText],
  );

  function patch(key: string, patcher: (d: Draft) => Draft): void {
    setDrafts((prev) => prev.map((d) => (d.key === key ? patcher(d) : d)));
  }

  function toggleTool(d: Draft, toolId: string): void {
    patch(d.key, (cur) => {
      const has = cur.toolPolicy.allowedTools.includes(toolId);
      return {
        ...cur,
        toolPolicy: {
          ...cur.toolPolicy,
          allowedTools: has
            ? cur.toolPolicy.allowedTools.filter((t) => t !== toolId)
            : [...cur.toolPolicy.allowedTools, toolId],
        },
      };
    });
  }

  function openAdvanced(): void {
    setJsonText(stringifyParticipants(drafts.map(toInput)));
    setAdvanced(true);
  }

  function applyJson(): void {
    const parsed = parseParticipantsJson(jsonText);
    if (!parsed.ok || !parsed.participants.length) {
      setError(parsed.error ?? '解析结果为空');
      return;
    }
    setDrafts(
      parsed.participants.map((p, i) => ({
        ...p,
        key: `json-${i}-${Math.random().toString(36).slice(2, 8)}`,
      })),
    );
    setError(null);
    setAdvanced(false);
  }

  async function start(): Promise<void> {
    setError(null);
    const participants = drafts
      .map(toInput)
      .filter((p) => p.participantId.trim().length > 0)
      .map((p) => ({
        ...p,
        participantId: p.participantId.trim(),
        harnessProfileId: p.harnessProfileId?.trim() || undefined,
      }));
    if (participants.length === 0) {
      setError('至少需要一个参与者（填 participantId）');
      return;
    }
    const ids = new Set(participants.map((p) => p.participantId));
    if (ids.size !== participants.length) {
      setError('参与者 id 不能重复');
      return;
    }
    // Harness 与模型必须成对：只填其一会在运行时才发现调不动模型
    const mismatch = participants.find(
      (p) =>
        (p.harnessProfileId && !p.modelBinding.modelProfileId) ||
        (!p.harnessProfileId && p.modelBinding.modelProfileId),
    );
    if (mismatch) {
      setError(
        `参与者 ${mismatch.participantId}：Harness Profile 与模型 Profile 必须同时选择（或同时留空表示纯人工派发）`,
      );
      return;
    }
    setSaving(true);
    try {
      await startOrchestration(runId, {
        participants,
        limits,
        workItems: workItems.length > 0 ? workItems : undefined,
      });
      onStarted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHead
        title="配置并启动编排"
        desc="参与者固定快照后不可热切换；填了 Harness + 模型即可让 Agent 真实发言，两者都留空则为纯人工派发。"
        actions={<Badge tone="info">未启动</Badge>}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {advanced ? (
        <div className="wb-col">
          <Field
            label="参与者 JSON（高级模式）"
            hint="解析成功并点「应用」后回到表单；解析失败不会改动表单内容。"
          >
            <Textarea
              rows={12}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              aria-label="参与者 JSON"
            />
          </Field>
          {jsonResult && !jsonResult.ok ? <Alert tone="warn">{jsonResult.error}</Alert> : null}
          <div className="wb-row" style={{ gap: 6 }}>
            <Button size="sm" variant="primary" onClick={applyJson}>
              应用到表单
            </Button>
            <Button size="sm" onClick={() => setAdvanced(false)}>
              取消（回到表单）
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="wb-col">
            {drafts.map((d, i) => (
              <div key={d.key} className="wb-participant">
                <div className="wb-row" style={{ gap: 6, alignItems: 'center' }}>
                  <strong style={{ fontSize: 12 }}>参与者 {i + 1}</strong>
                  <span className="wb-spacer" />
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    icon={<Trash size={13} aria-hidden="true" />}
                    aria-label={`删除参与者 ${i + 1}`}
                    onClick={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))}
                  >
                    删除
                  </Button>
                </div>
                <div className="wb-form-grid">
                  <Field label="participantId" hint="发言时显示的身份，如 pm / dev / reviewer">
                    <Input
                      value={d.participantId}
                      onChange={(e) =>
                        patch(d.key, (cur) => ({ ...cur, participantId: e.target.value }))
                      }
                      placeholder="pm"
                      aria-label={`参与者 ${i + 1} id`}
                    />
                  </Field>
                  <Field label="角色设定" hint="写进快照，并作为该参与者的提示词首行">
                    <Input
                      value={d.systemInstruction ?? ''}
                      onChange={(e) =>
                        patch(d.key, (cur) => ({ ...cur, systemInstruction: e.target.value }))
                      }
                      placeholder="你是产品经理，只写需求要点"
                      aria-label={`参与者 ${i + 1} 角色设定`}
                    />
                  </Field>
                  <Field label="Harness Profile" hint="留空 = 该参与者不自动发言（需人工代发言）">
                    <Select
                      value={d.harnessProfileId ?? ''}
                      onChange={(e) =>
                        patch(d.key, (cur) => ({ ...cur, harnessProfileId: e.target.value }))
                      }
                      aria-label={`参与者 ${i + 1} Harness Profile`}
                    >
                      <option value="">（不自动发言）</option>
                      {harnessProfiles.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name || h.id} · {h.adapterType}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="模型 Profile" hint="与 Harness 成对使用">
                    <Select
                      value={d.modelBinding.modelProfileId}
                      onChange={(e) =>
                        patch(d.key, (cur) => ({
                          ...cur,
                          modelBinding: { ...cur.modelBinding, modelProfileId: e.target.value },
                        }))
                      }
                      aria-label={`参与者 ${i + 1} 模型 Profile`}
                    >
                      <option value="">（无）</option>
                      {modelProfiles.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name || m.id}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div style={{ marginTop: 'var(--wb-space-2)' }}>
                  <div className="wb-muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    工具白名单（{d.toolPolicy.allowedTools.length}）：不勾 = 该参与者调不动任何工具
                  </div>
                  <div className="wb-row wb-wrap" style={{ gap: 4 }}>
                    {HARNESS_TOOL_IDS.map((toolId) => {
                      const on = d.toolPolicy.allowedTools.includes(toolId);
                      return (
                        <button
                          key={toolId}
                          type="button"
                          aria-pressed={on}
                          className={cx('wb-chip-btn', on && 'wb-chip-btn--on')}
                          onClick={() => toggleTool(d, toolId)}
                        >
                          {toolId}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="wb-row" style={{ gap: 6, marginTop: 'var(--wb-space-2)' }}>
            <Button
              size="sm"
              icon={<Plus size={13} aria-hidden="true" />}
              onClick={() => setDrafts((prev) => [...prev, newDraft(prev.length)])}
            >
              添加参与者
            </Button>
            <Button size="sm" onClick={openAdvanced}>
              以 JSON 编辑
            </Button>
          </div>

          <div className="wb-form-grid" style={{ marginTop: 'var(--wb-space-3)' }}>
            <Field label="轮次上限">
              <Input
                type="number"
                value={limits.maxTurns}
                onChange={(e) =>
                  setLimits((l) => ({ ...l, maxTurns: Number(e.target.value) || 0 }))
                }
                aria-label="轮次上限"
              />
            </Field>
            <Field label="Token 上限">
              <Input
                type="number"
                value={limits.maxTotalTokens}
                onChange={(e) =>
                  setLimits((l) => ({ ...l, maxTotalTokens: Number(e.target.value) || 0 }))
                }
                aria-label="Token 上限"
              />
            </Field>
            <Field label="时长上限（秒）">
              <Input
                type="number"
                value={limits.maxDurationSeconds}
                onChange={(e) =>
                  setLimits((l) => ({ ...l, maxDurationSeconds: Number(e.target.value) || 0 }))
                }
                aria-label="时长上限"
              />
            </Field>
            <Field label="成本上限">
              <Input
                type="number"
                value={limits.maxCost}
                onChange={(e) => setLimits((l) => ({ ...l, maxCost: Number(e.target.value) || 0 }))}
                aria-label="成本上限"
              />
            </Field>
          </div>

          <div className="wb-form-grid" style={{ marginTop: 'var(--wb-space-2)' }}>
            <Field label="初始任务 kind" hint="可留空：任务也能在运行时加">
              <Input
                value={workItemKind}
                onChange={(e) => setWorkItemKind(e.target.value)}
                placeholder="draft-spec"
                aria-label="初始任务 kind"
              />
            </Field>
            <Field label="指派给">
              <Select
                value={''}
                onChange={(e) => {
                  if (!workItemKind.trim()) return;
                  setWorkItems((prev) => [
                    ...prev,
                    { kind: workItemKind.trim(), assigneeRef: e.target.value || null },
                  ]);
                  setWorkItemKind('');
                }}
                aria-label="初始任务指派给"
              >
                <option value="">（添加任务…）</option>
                {drafts
                  .filter((d) => d.participantId.trim())
                  .map((d) => (
                    <option key={d.key} value={d.participantId.trim()}>
                      {d.participantId.trim()}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>

          {workItems.length > 0 ? (
            <ul className="wb-entity-list">
              {workItems.map((w, i) => (
                <li key={`${w.kind}-${i}`} className="wb-entity">
                  {w.kind} → {w.assigneeRef ?? '未指派'}
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    onClick={() => setWorkItems((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    移除
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          <div style={{ marginTop: 'var(--wb-space-3)' }}>
            <Button variant="primary" loading={saving} onClick={() => void start()}>
              启动编排
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function toInput(d: Draft): ParticipantInput {
  return {
    participantId: d.participantId,
    agentProfileId: d.agentProfileId,
    harnessProfileId: d.harnessProfileId,
    modelBinding: d.modelBinding,
    toolPolicy: d.toolPolicy,
    systemInstruction: d.systemInstruction,
  };
}
