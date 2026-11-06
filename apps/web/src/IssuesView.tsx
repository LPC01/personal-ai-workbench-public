import { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { createIssue, listIssues, resolveIssue, verifyIssue, type Issue } from './api';
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
  statusBadgeTone,
} from './ui';
import { useNarrow } from './use-narrow';

/** Issue 界面（25 设计 §6.11：Issue → Resolution → Verification → Lesson）。 */
export default function IssuesView() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const narrow = useNarrow();

  async function refresh() {
    try {
      const r = await listIssues();
      setIssues(r.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // 挂载即加载：原来只在点击「刷新」后才拉数据，首屏恒为空
  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      await createIssue(title || '未命名', description);
      setTitle('');
      setDescription('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAction(id: string, kind: 'resolve' | 'verify') {
    setError(null);
    try {
      if (kind === 'resolve') {
        await resolveIssue(id);
      } else {
        await verifyIssue(id);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <PageBody narrow={narrow}>
      <PageHead
        title="Issue · 经验沉淀"
        desc="Issue → Resolution → Verification → Lesson。"
        actions={
          <Button icon={<RefreshCw size={14} aria-hidden="true" />} onClick={refresh}>
            刷新
          </Button>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardHead title="登记新问题" desc="描述可留空，后续补充再编辑。" />
        <div className="wb-row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <Field label="问题标题">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="一句话描述问题"
                aria-label="问题标题"
              />
            </Field>
          </div>
          <div style={{ flex: 2, minWidth: 220 }}>
            <Field label="问题描述">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="现象、影响范围、触发条件"
                aria-label="问题描述"
              />
            </Field>
          </div>
          <Button
            variant="primary"
            icon={<Plus size={14} aria-hidden="true" />}
            loading={busy}
            onClick={onCreate}
          >
            创建
          </Button>
        </div>
      </Card>

      <Card>
        <CardHead title={`Issue 列表（${issues.length}）`} />
        {issues.length === 0 ? (
          <EmptyState title="暂无 Issue" desc="创建第一个 Issue，把一次踩坑沉淀成可检索的经验。" />
        ) : (
          <Table label="Issue 列表">
            <thead>
              <tr>
                <Th>标题</Th>
                <Th>描述</Th>
                <Th>状态</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id}>
                  <Td>
                    <strong style={{ fontWeight: 600 }}>{issue.title}</strong>
                  </Td>
                  <Td className="wb-muted">{issue.description}</Td>
                  <Td>
                    <Badge tone={statusBadgeTone(issue.status)}>{issue.status}</Badge>
                  </Td>
                  <Td>
                    {issue.status === 'OPEN' ? (
                      <Button size="sm" onClick={() => onAction(issue.id, 'resolve')}>
                        解决
                      </Button>
                    ) : null}
                    {issue.status === 'RESOLVED' ? (
                      <Button size="sm" onClick={() => onAction(issue.id, 'verify')}>
                        验证
                      </Button>
                    ) : null}
                    {issue.status !== 'OPEN' && issue.status !== 'RESOLVED' ? (
                      <span className="wb-muted" style={{ fontSize: 12 }}>
                        无可用操作
                      </span>
                    ) : null}
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
