import { useState } from 'react';
import { Send, SquarePen } from 'lucide-react';
import { autoTurn, dispatchRoomTurn } from './api';
import { describeStopReason, nextSpeaker } from './room-run';
import { Alert, Badge, Button, Card, CardHead, Field, Select, Textarea } from './ui';

/**
 * 发言控制台（UI-10）。
 *
 * 两条路径都走编排门禁：
 * - **发送并推进**：写 USER_MESSAGE 后由后端按协议（轮询/指定）推进 N 位参与者真实发言；
 * - **手动代发言**：不经模型，直接以某参与者身份派发内容（用于补录/纠偏）。
 */
export default function RoomComposer({
  runId,
  participants,
  lastAgentSpeaker,
  disabled,
  onSent,
}: {
  runId: string;
  participants: string[];
  lastAgentSpeaker: string | null;
  disabled: boolean;
  onSent: () => void;
}) {
  const [message, setMessage] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [rounds, setRounds] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [manualWho, setManualWho] = useState('');
  const [manualText, setManualText] = useState('');

  const auto = nextSpeaker(participants, lastAgentSpeaker);
  const canAuto = participants.length > 0;

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await autoTurn(runId, {
        content: message.trim() || undefined,
        participantId: speaker || undefined,
        rounds: Math.max(1, Math.min(rounds, Math.max(1, participants.length))),
      });
      setMessage('');
      const okCount = res.turns.filter((t) => t.status === 'SUCCEEDED').length;
      const parts = [`已推进 ${okCount}/${res.turns.length} 位参与者发言`];
      if (res.stoppedReason) {
        parts.push(`提前停止：${describeStopReason(res.stoppedReason) ?? res.stoppedReason}`);
      }
      setNote(parts.join('；'));
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendManual(): Promise<void> {
    if (!manualWho || !manualText.trim()) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await dispatchRoomTurn(runId, {
        participantId: manualWho,
        allowedParticipants: participants,
        content: manualText.trim(),
        tokens: Math.max(1, Math.ceil(manualText.trim().length / 4)),
      });
      setManualText('');
      setNote(`已以 ${manualWho} 身份记录一段发言（未调用模型）`);
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead
        title="发言"
        desc={
          canAuto
            ? `协议轮询：下一位是 ${auto ?? '—'}；也可手动指定。`
            : '尚未启动编排，没有参与者可发言。'
        }
        actions={
          canAuto ? <Badge tone="info">自动轮次</Badge> : <Badge tone="warn">未启动编排</Badge>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {note ? <Alert tone="success">{note}</Alert> : null}

      <Field label="你的消息" hint="留空则只推进 Agent 发言（不新增用户消息）">
        <Textarea
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="给协作组下达本轮目标…"
          aria-label="你的消息"
        />
      </Field>

      <div className="wb-form-grid" style={{ marginTop: 'var(--wb-space-2)' }}>
        <Field label="指定发言人" hint="不选 = 按协议轮询">
          <Select
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
            disabled={!canAuto}
            aria-label="指定发言人"
          >
            <option value="">自动（轮询 → {auto ?? '—'}）</option>
            {participants.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="连续推进轮数" hint={`最多不超过参与者数（${participants.length}）`}>
          <Select
            value={rounds}
            onChange={(e) => setRounds(Number(e.target.value))}
            aria-label="连续推进轮数"
          >
            {Array.from({ length: Math.max(1, participants.length) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="wb-row" style={{ gap: 6, marginTop: 'var(--wb-space-2)' }}>
        <Button
          variant="primary"
          icon={<Send size={14} aria-hidden="true" />}
          loading={busy}
          disabled={disabled || !canAuto}
          onClick={() => void send()}
        >
          发送并推进
        </Button>
        <Button
          size="sm"
          icon={<SquarePen size={13} aria-hidden="true" />}
          onClick={() => setManual((v) => !v)}
        >
          手动代发言
        </Button>
      </div>

      {manual ? (
        <div className="wb-col" style={{ marginTop: 'var(--wb-space-2)' }}>
          <Field label="以谁的身份">
            <Select
              value={manualWho}
              onChange={(e) => setManualWho(e.target.value)}
              aria-label="手动代发言身份"
            >
              <option value="">（选择参与者）</option>
              {participants.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="内容" hint="不经模型，直接写入该参与者的一条 AGENT_MESSAGE">
            <Textarea
              rows={2}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              aria-label="手动代发言内容"
            />
          </Field>
          <Button
            size="sm"
            disabled={!manualWho || !manualText.trim() || busy}
            onClick={() => void sendManual()}
          >
            派发
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
