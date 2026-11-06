import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Cpu,
  Pencil,
  Plug,
  Plus,
  Save,
  TriangleAlert,
} from 'lucide-react';
import {
  createCredential,
  deleteCredential,
  probeProvider,
  upsertProfile,
  upsertProvider,
  type ModelProfile,
  type ModelProvider,
  type ProbeResult,
} from './api';
import { avatarHue, avatarInitial } from './avatar';
import { CredentialFields, type CredentialValue } from './CredentialFields';
import { planCredentialUpdate } from './credential-plan';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Field,
  Input,
  Select,
  useToast,
} from './ui';

/**
 * Provider 卡片（模型页两级结构的一级单元）。
 *
 * 结构参考 GitHub 热门项目的跨栈共识（见 `docs/design/model-settings-ui-research.md` §5）：
 * Provider 是一级卡片、Profile 是它的展开子项；「测试连接」是卡片主操作；
 * 凭据独立于主表单。
 */
export interface ModelProviderCardProps {
  provider: ModelProvider;
  /** 归属该 Provider 的 Profile（由页面侧按 providerId 分组后传入）。 */
  profiles: ModelProfile[];
  /** 保存成功后触发（通常重新拉取列表）。 */
  onChanged: () => void;
}

// 头像取色/取首字已抽到共享模块（项目卡片共用同一规则），此处保留再导出以兼容既有用法。
export { avatarHue, avatarInitial } from './avatar';

type ProfileFormMode = 'none' | 'create' | 'edit';

export function ModelProviderCard({ provider, profiles, onChanged }: ModelProviderCardProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);

  // Provider 表单：进入编辑态时才回填，避免 props 变化与用户输入互相打断。
  const [name, setName] = useState(provider.name);
  const [type, setType] = useState<ModelProvider['type']>(provider.type);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '');
  const [cred, setCred] = useState<CredentialValue>({
    ref: provider.credentialRef ?? '',
    secret: '',
  });

  // Profile 表单
  const [pfMode, setPfMode] = useState<ProfileFormMode>('none');
  const [pfSaving, setPfSaving] = useState(false);
  const [pfId, setPfId] = useState('');
  const [pfName, setPfName] = useState('');
  const [pfModelId, setPfModelId] = useState('');
  const [pfBoundary, setPfBoundary] = useState<ModelProfile['dataBoundary']>('local-only');

  function startEditProvider() {
    setName(provider.name);
    setType(provider.type);
    setBaseUrl(provider.baseUrl ?? '');
    setCred({ ref: provider.credentialRef ?? '', secret: '' });
    setError(null);
    setEditing(true);
  }

  function startCreateProfile() {
    setPfMode('create');
    setPfId('');
    setPfName('');
    setPfModelId('');
    setPfBoundary('local-only');
    setError(null);
    setOpen(true);
  }

  function startEditProfile(pf: ModelProfile) {
    setPfMode('edit');
    setPfId(pf.id);
    setPfName(pf.name);
    setPfModelId(pf.modelId);
    setPfBoundary(pf.dataBoundary);
    setError(null);
    setOpen(true);
  }

  async function saveProvider() {
    setSaving(true);
    setError(null);
    let createdRef: string | null = null;
    try {
      const plan = planCredentialUpdate({
        existingRef: provider.credentialRef,
        typedRef: cred.ref,
        secret: cred.secret,
      });
      let credentialRef = plan.credentialRef;
      if (plan.action === 'create') {
        const created = await createCredential({ type: 'api_key', secret: cred.secret.trim() });
        credentialRef = created.ref;
        createdRef = created.ref;
        // 明文只活到这一步：登记成功后立即从表单状态抹除，界面只保留引用。
        setCred({ ref: created.ref, secret: '' });
      }
      await upsertProvider({
        id: provider.id,
        name: name.trim() || provider.name,
        type,
        // Open WebUI 同款输入清洗：去尾斜杠，避免拼接出 //v1
        baseUrl: baseUrl.trim().replace(/\/+$/, ''),
        credentialRef,
      });
      toast.success(
        createdRef
          ? `已保存：${provider.id}（已登记并绑定凭据 ${createdRef}）`
          : `已保存：${provider.id}`,
      );
      setEditing(false);
      onChanged();
    } catch (e) {
      // 凭据已登记但绑定失败时如实交代 ref，避免用户重复录入同一密钥
      setError(
        createdRef
          ? `绑定失败：${(e as Error).message}（凭据 ${createdRef} 已登记，可填入 credentialRef 复用）`
          : (e as Error).message,
      );
    } finally {
      setSaving(false);
    }
  }

  /** 销毁凭据本体：必须先解绑再删除，顺序颠倒会在 Provider 上留下悬空引用。 */
  async function destroyCredential(ref: string) {
    if (!ref) return;
    setSaving(true);
    setError(null);
    try {
      await upsertProvider({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        baseUrl: provider.baseUrl ?? '',
        credentialRef: null,
      });
      await deleteCredential(ref);
      setCred({ ref: '', secret: '' });
      toast.success(`已解绑并销毁凭据：${ref}`);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile() {
    if (!pfModelId.trim()) return;
    setPfSaving(true);
    setError(null);
    try {
      await upsertProfile({
        id: pfId.trim(),
        name: pfName.trim() || pfId.trim(),
        providerId: provider.id,
        modelId: pfModelId.trim(),
        capabilities: ['chat'],
        contextLimit: 32768,
        dataBoundary: pfBoundary,
      });
      toast.success(`已保存 Profile：${pfId.trim()}（revision 递增）`);
      setPfMode('none');
      setOpen(true);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPfSaving(false);
    }
  }

  async function runProbe() {
    setProbing(true);
    setProbe(null);
    setError(null);
    try {
      setProbe(await probeProvider(provider.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProbing(false);
    }
  }

  const hue = avatarHue(provider.id);
  const expandId = `profiles-${provider.id}`;

  return (
    <Card aria-label={`Provider ${provider.name}`}>
      <div className="wb-provider__head">
        <span
          className="wb-avatar"
          style={{ background: `hsl(${hue} 52% 42%)` }}
          aria-hidden="true"
        >
          {avatarInitial(provider.name)}
        </span>
        <div className="wb-provider__idblock">
          <div className="wb-provider__name">
            <span className="wb-provider__title">{provider.name}</span>
            <Badge tone="neutral">{provider.type}</Badge>
            {provider.credentialRef ? (
              <Badge tone="success">已绑凭据</Badge>
            ) : (
              <Badge tone="neutral">无需鉴权</Badge>
            )}
            <Badge tone="info">{profiles.length} 个 Profile</Badge>
          </div>
          <div className="wb-provider__url">
            {provider.id} · revision {provider.revision}
          </div>
          {provider.baseUrl ? (
            <div className="wb-provider__url">{provider.baseUrl}</div>
          ) : (
            <div className="wb-provider__url">未设置 baseUrl</div>
          )}
        </div>
        <div className="wb-provider__actions">
          <Button
            size="sm"
            icon={<Plug size={13} aria-hidden="true" />}
            loading={probing}
            onClick={runProbe}
          >
            测试连接
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Pencil size={13} aria-hidden="true" />}
            aria-expanded={editing}
            onClick={() => (editing ? setEditing(false) : startEditProvider())}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            aria-expanded={open}
            aria-controls={expandId}
            onClick={() => setOpen(!open)}
          >
            Profile
          </Button>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 'var(--wb-space-3)' }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      {probe ? (
        <div className="wb-probe">
          <div className="wb-probe__head">
            {probe.healthy ? (
              <CircleCheck size={13} style={{ color: 'var(--wb-success)' }} aria-hidden="true" />
            ) : (
              <TriangleAlert size={13} style={{ color: 'var(--wb-danger)' }} aria-hidden="true" />
            )}
            <span>
              {probe.healthy
                ? `在线 · ${probe.models.length} 个模型`
                : `不可用：${probe.error ?? '未知原因'}`}
            </span>
          </div>
          {probe.models.length > 0 ? (
            <div className="wb-row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
              {probe.models.slice(0, 12).map((m) => (
                <span key={m} className="wb-chip" title={m}>
                  {m}
                </span>
              ))}
              {probe.models.length > 12 ? (
                <span className="wb-muted">…另有 {probe.models.length - 12} 个</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <div className="wb-provider__body">
          <CardHead title={`编辑 ${provider.id}`} desc="id 不可修改；保存后 revision 递增。" />
          <div className="wb-form-grid">
            <Field label="名称" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Provider 名称"
              />
            </Field>
            <Field label="类型">
              <Select
                value={type}
                onChange={(e) => setType(e.target.value as ModelProvider['type'])}
                aria-label="Provider 类型"
              >
                <option value="ollama">ollama</option>
                <option value="openai-compatible">openai-compatible</option>
              </Select>
            </Field>
            <Field label="baseUrl" hint="保存时自动去除结尾斜杠">
              <Input
                placeholder="http://127.0.0.1:11434"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                aria-label="Provider baseUrl"
              />
            </Field>
          </div>

          <CredentialFields
            value={cred}
            onChange={setCred}
            boundRef={provider.credentialRef}
            disabled={saving}
            onDestroy={(ref) => destroyCredential(ref)}
          />

          <div className="wb-row" style={{ marginTop: 'var(--wb-space-4)' }}>
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={13} aria-hidden="true" />}
              loading={saving}
              onClick={saveProvider}
              aria-label="保存 Provider"
            >
              保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : null}

      <div id={expandId}>
        {open ? (
          <div className="wb-provider__body">
            {pfMode !== 'none' ? (
              <Card flat soft>
                <CardHead
                  title={pfMode === 'create' ? '新增 Profile' : `编辑 Profile：${pfId}`}
                  desc={`providerId 固定为 ${provider.id}，不可手改`}
                />
                <div className="wb-form-grid">
                  <Field label="ID" required>
                    <Input
                      placeholder="local-chat"
                      value={pfId}
                      disabled={pfMode === 'edit'}
                      onChange={(e) => setPfId(e.target.value)}
                      aria-label="Profile ID"
                    />
                  </Field>
                  <Field label="名称">
                    <Input
                      value={pfName}
                      onChange={(e) => setPfName(e.target.value)}
                      aria-label="Profile 名称"
                    />
                  </Field>
                  <Field label="modelId" required>
                    <Input
                      placeholder="qwen2.5:7b"
                      value={pfModelId}
                      onChange={(e) => setPfModelId(e.target.value)}
                      aria-label="Profile modelId"
                    />
                  </Field>
                  <Field
                    label="数据边界"
                    hint={pfBoundary === 'cloud' ? 'cloud 在对话前需经本地转云端审批' : undefined}
                  >
                    <Select
                      value={pfBoundary}
                      onChange={(e) =>
                        setPfBoundary(e.target.value as ModelProfile['dataBoundary'])
                      }
                      aria-label="Profile 数据边界"
                    >
                      <option value="local-only">local-only</option>
                      <option value="cloud">cloud</option>
                    </Select>
                  </Field>
                </div>
                <div className="wb-row" style={{ marginTop: 'var(--wb-space-4)' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Save size={13} aria-hidden="true" />}
                    loading={pfSaving}
                    onClick={saveProfile}
                    aria-label="保存 Profile"
                  >
                    保存
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPfMode('none')}>
                    取消
                  </Button>
                </div>
                <Alert tone="info" label="能力字段说明">
                  capabilities 固定写入 chat。该字段与
                  contextLimit、defaultParams、fallbackProfileId
                  目前运行时无消费方，故不提供界面修改，避免出现「填了不生效」的误导。
                </Alert>
              </Card>
            ) : null}

            {profiles.length === 0 && pfMode === 'none' ? (
              <EmptyState
                icon={<Cpu size={24} aria-hidden="true" />}
                title="该 Provider 下暂无 Profile"
                desc="Profile 绑定具体模型与数据边界，Run 快照引用的是 Profile。"
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Plus size={13} aria-hidden="true" />}
                    onClick={startCreateProfile}
                  >
                    新增 Profile
                  </Button>
                }
              />
            ) : null}

            {profiles.length > 0 ? (
              <ul
                className="wb-entity-list"
                style={{ marginTop: pfMode === 'none' ? 0 : 'var(--wb-space-4)' }}
              >
                {profiles.map((pf) => (
                  <li key={pf.id} className="wb-profile-row">
                    <div className="wb-profile-row__main">
                      <div className="wb-provider__name">
                        <span className="wb-provider__title">{pf.name}</span>
                      </div>
                      <div className="wb-provider__url">
                        {pf.id} · revision {pf.revision}
                      </div>
                    </div>
                    <span className="wb-chip" title={pf.modelId}>
                      {pf.modelId}
                    </span>
                    <Badge tone={pf.dataBoundary === 'cloud' ? 'warn' : 'success'}>
                      {pf.dataBoundary}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Pencil size={13} aria-hidden="true" />}
                      onClick={() => startEditProfile(pf)}
                      aria-label={`编辑 Profile ${pf.id}`}
                    >
                      编辑
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}

            {profiles.length > 0 && pfMode === 'none' ? (
              <div className="wb-row" style={{ marginTop: 'var(--wb-space-3)' }}>
                <Button
                  size="sm"
                  icon={<Plus size={13} aria-hidden="true" />}
                  onClick={startCreateProfile}
                >
                  新增 Profile
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
