import { useState } from 'react';
import { Wand } from 'lucide-react';
import {
  addStudioMessage,
  createStudioSession,
  generateSpec,
  getPermissionReview,
  type PermissionReview,
} from './api';
import SchemaForm from './SchemaForm';
import SandboxedFrame from './SandboxedFrame';
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
  Table,
  Td,
  Th,
  type BadgeTone,
} from './ui';

/** 会议纪要输入 Schema 演示（Schema UI）。 */
const DEMO_SCHEMA = {
  type: 'object' as const,
  properties: {
    text: { type: 'string', title: '会议原文' },
    language: { type: 'string', title: '输出语言', enum: ['中文', 'English'] },
    withActionItems: { type: 'boolean', title: '是否生成行动项' },
  },
  required: ['text'],
};

/** 风险等级 → 徽章色调（纯函数）。 */
function riskTone(level: string): BadgeTone {
  if (level === 'high') return 'danger';
  if (level === 'medium') return 'warn';
  return 'success';
}

/** Studio 权限与数据流审阅页（25 设计 §10.3）。 */
export default function StudioView() {
  const [title, setTitle] = useState('');
  const [requirement, setRequirement] = useState('');
  const [review, setReview] = useState<PermissionReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const narrow = useNarrow();

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const session = await createStudioSession(title || '未命名会话');
      await addStudioMessage(session.id, requirement || '整理会议纪要');
      const draft = await generateSpec(session.id);
      const result = await getPermissionReview(draft.id);
      setReview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageBody narrow={narrow}>
      <PageHead
        title="扩展工坊"
        desc="输入需求生成扩展 Spec，并审阅其权限与数据流。"
        actions={
          <Button
            variant="primary"
            icon={<Wand size={14} aria-hidden="true" />}
            loading={busy}
            onClick={run}
          >
            {busy ? '生成中…' : '生成并审阅'}
          </Button>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardHead title="生成 Spec" desc="会话标题与需求均可留空，服务端会给出默认值。" />
        <div className="wb-row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <Field label="扩展名称">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="如：会议纪要助手"
                aria-label="扩展名称"
              />
            </Field>
          </div>
          <div style={{ flex: 2, minWidth: 220 }}>
            <Field label="需求描述">
              <Input
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                placeholder="如：帮我整理会议纪要"
                aria-label="需求描述"
              />
            </Field>
          </div>
        </div>
      </Card>

      {review ? (
        <Card>
          <CardHead title={review.extensionName} desc="权限与数据流审阅结果。" />
          <Table label="数据流">
            <thead>
              <tr>
                <Th>维度</Th>
                <Th>内容</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>读入</Td>
                <Td>{review.dataFlow.inputs.join(', ') || '—'}</Td>
              </tr>
              <tr>
                <Td>产出</Td>
                <Td>{review.dataFlow.outputs.join(', ') || '—'}</Td>
              </tr>
              <tr>
                <Td>命令</Td>
                <Td>{review.dataFlow.commands.join(', ') || '—'}</Td>
              </tr>
              <tr>
                <Td>网络</Td>
                <Td>
                  <Badge tone={review.dataFlow.network ? 'warn' : 'neutral'}>
                    {review.dataFlow.network ? '是' : '否'}
                  </Badge>
                </Td>
              </tr>
              <tr>
                <Td>凭据</Td>
                <Td>{review.dataFlow.credentials.join(', ') || '—'}</Td>
              </tr>
            </tbody>
          </Table>

          <div style={{ marginTop: 'var(--wb-space-4)' }}>
            <CardHead title="风险" desc="等级由服务端判定，页面如实展示。" />
            {review.risks.length === 0 ? (
              <EmptyState title="无风险项" desc="该 Spec 未检出高风险权限或数据流。" />
            ) : (
              <ul className="wb-risk-list">
                {review.risks.map((r, i) => (
                  <li key={i}>
                    <Badge tone={riskTone(r.level)}>{r.level}</Badge>
                    <span>{r.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHead title="Schema UI" desc="输入表单由 JSON Schema 驱动。" />
        <div style={{ maxWidth: 360 }}>
          <SchemaForm schema={DEMO_SCHEMA} />
        </div>
      </Card>

      <Card>
        <CardHead title="沙箱 iframe" desc="postMessage 来源白名单校验演示。" />
        <SandboxedFrame
          allowedSources={['meeting-minutes']}
          srcDoc={
            "<button onclick=\"parent.postMessage({source:'meeting-minutes',type:'render',payload:{}},'*')\">发送 render 消息</button>"
          }
        />
      </Card>
    </PageBody>
  );
}
