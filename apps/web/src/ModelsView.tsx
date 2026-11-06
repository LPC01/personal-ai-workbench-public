import { useCallback, useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import {
  createCredential,
  listProfiles,
  listProviders,
  upsertProvider,
  type ModelProfile,
  type ModelProvider,
} from './api';
import { CredentialFields, type CredentialValue } from './CredentialFields';
import { planCredentialUpdate } from './credential-plan';
import { ModelProviderCard } from './ModelProviderCard';
import { useNarrow } from './use-narrow';
import {
  Alert,
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
  useToast,
} from './ui';

export interface ModelTree {
  providers: ModelProvider[];
  /** Provider id → 其下的 Profile（已按过滤条件收敛）。 */
  profilesByProvider: Map<string, ModelProfile[]>;
  /** providerId 指向不存在 Provider 的孤儿 Profile。 */
  orphanProfiles: ModelProfile[];
}

function hit(fields: (string | null)[], q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle.length === 0) return true;
  return fields.some((f) => (f ?? '').toLowerCase().includes(needle));
}

/**
 * 把扁平的 Provider / Profile 组装成两级树，并应用搜索过滤（纯函数，便于单测）。
 *
 * 两级结构下孤儿 Profile 会「无处挂载」，故单独返回，页面必须显式呈现它们。
 */
export function buildModelTree(
  providers: ModelProvider[],
  profiles: ModelProfile[],
  query = '',
): ModelTree {
  const profilesByProvider = new Map<string, ModelProfile[]>();
  const orphans: ModelProfile[] = [];
  for (const p of providers) profilesByProvider.set(p.id, []);
  for (const pf of profiles) {
    const bucket = profilesByProvider.get(pf.providerId);
    if (bucket) bucket.push(pf);
    else orphans.push(pf);
  }

  const q = query.trim();
  const visible = providers.filter(
    (p) =>
      hit([p.name, p.id, p.baseUrl, p.type], q) ||
      (profilesByProvider.get(p.id) ?? []).some((pf) => hit([pf.name, pf.id, pf.modelId], q)),
  );

  // Provider 自身未命中、但有 Profile 命中时，只保留命中的 Profile，避免歧义。
  if (q.length > 0) {
    for (const p of visible) {
      if (hit([p.name, p.id, p.baseUrl, p.type], q)) continue;
      profilesByProvider.set(
        p.id,
        (profilesByProvider.get(p.id) ?? []).filter((pf) => hit([pf.name, pf.id, pf.modelId], q)),
      );
    }
  }

  return {
    providers: visible,
    profilesByProvider,
    orphanProfiles:
      q.length > 0 ? orphans.filter((pf) => hit([pf.name, pf.id, pf.modelId], q)) : orphans,
  };
}

export default function ModelsView() {
  const toast = useToast();
  const narrow = useNarrow();
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cId, setCId] = useState('');
  const [cName, setCName] = useState('');
  const [cType, setCType] = useState<ModelProvider['type']>('ollama');
  const [cBaseUrl, setCBaseUrl] = useState('');
  const [cCred, setCCred] = useState<CredentialValue>({ ref: '', secret: '' });

  const refresh = useCallback(async () => {
    try {
      const [pv, pf] = await Promise.all([listProviders(), listProfiles()]);
      setProviders(pv.items);
      setProfiles(pf.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createProvider() {
    if (!cId.trim()) return;
    setSaving(true);
    setError(null);
    let createdRef: string | null = null;
    try {
      const plan = planCredentialUpdate({
        existingRef: null,
        typedRef: cCred.ref,
        secret: cCred.secret,
      });
      let credentialRef = plan.credentialRef;
      if (plan.action === 'create') {
        const created = await createCredential({ type: 'api_key', secret: cCred.secret.trim() });
        credentialRef = created.ref;
        createdRef = created.ref;
        // 明文只活到这一步：登记成功后立即从表单状态抹除。
        setCCred({ ref: created.ref, secret: '' });
      }
      await upsertProvider({
        id: cId.trim(),
        name: cName.trim() || cId.trim(),
        type: cType,
        baseUrl: cBaseUrl.trim().replace(/\/+$/, '') || undefined,
        credentialRef,
      });
      toast.success(
        createdRef
          ? `已登记 Provider：${cId.trim()}（凭据 ${createdRef}）`
          : `已登记 Provider：${cId.trim()}`,
      );
      setCId('');
      setCName('');
      setCBaseUrl('');
      setCCred({ ref: '', secret: '' });
      setCreating(false);
      await refresh();
    } catch (e) {
      setError(
        createdRef
          ? `绑定失败：${(e as Error).message}（凭据 ${createdRef} 已登记，可填入 credentialRef 复用）`
          : (e as Error).message,
      );
    } finally {
      setSaving(false);
    }
  }

  const tree = buildModelTree(providers, profiles, query);

  return (
    <PageBody narrow={narrow}>
      <PageHead
        title="模型设置"
        desc={
          providers.length > 0
            ? `Provider 是一级单元，Profile 是它下面的具体模型 · 共 ${providers.length} 个 Provider / ${profiles.length} 个 Profile`
            : 'Provider 是一级单元，Profile 是它下面的具体模型。先登记 Provider，再在其下建立 Profile。'
        }
        actions={
          <>
            <div style={{ minWidth: 160 }}>
              <Field label="搜索">
                <Input
                  placeholder="名称 / ID / 模型名"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="搜索 Provider 与 Profile"
                />
              </Field>
            </div>
            <Button
              variant="primary"
              icon={<Plus size={14} aria-hidden="true" />}
              aria-expanded={creating}
              onClick={() => setCreating(!creating)}
            >
              新增 Provider
            </Button>
          </>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {creating ? (
        <Card>
          <CardHead
            title="新增 Provider"
            desc="id 保存后不可修改。可直接录入 API Key：提交时登记到凭据存储，只把引用写进 Provider。"
          />
          <div className="wb-form-grid">
            <Field label="ID" required>
              <Input
                placeholder="local-ollama"
                value={cId}
                onChange={(e) => setCId(e.target.value)}
                aria-label="Provider ID"
              />
            </Field>
            <Field label="名称">
              <Input
                placeholder="本地 Ollama"
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                aria-label="Provider 名称"
              />
            </Field>
            <Field label="类型">
              <Select
                value={cType}
                onChange={(e) => setCType(e.target.value as ModelProvider['type'])}
                aria-label="Provider 类型"
              >
                <option value="ollama">ollama</option>
                <option value="openai-compatible">openai-compatible</option>
              </Select>
            </Field>
            <Field label="baseUrl" hint="保存时自动去除结尾斜杠">
              <Input
                placeholder="http://127.0.0.1:11434"
                value={cBaseUrl}
                onChange={(e) => setCBaseUrl(e.target.value)}
                aria-label="Provider baseUrl"
              />
            </Field>
          </div>
          <CredentialFields value={cCred} onChange={setCCred} disabled={saving} />
          <div className="wb-row" style={{ marginTop: 'var(--wb-space-4)' }}>
            <Button
              variant="primary"
              loading={saving}
              onClick={createProvider}
              aria-label="保存新 Provider"
            >
              保存
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              取消
            </Button>
          </div>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <SkeletonLines lines={4} />
        </Card>
      ) : tree.providers.length === 0 ? (
        <Card>
          {query.trim().length > 0 ? (
            <EmptyState
              icon={<Search size={26} aria-hidden="true" />}
              title="没有匹配的 Provider"
              desc={`没有 Provider 或 Profile 匹配「${query.trim()}」。`}
              action={
                <Button size="sm" onClick={() => setQuery('')}>
                  清除搜索
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="暂无 Provider"
              desc="Provider 是连接层：先有 Provider，才能在它下面建立 Profile。"
              action={
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus size={13} aria-hidden="true" />}
                  onClick={() => setCreating(true)}
                >
                  登记第一个 Provider
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        tree.providers.map((p) => (
          <ModelProviderCard
            key={p.id}
            provider={p}
            profiles={tree.profilesByProvider.get(p.id) ?? []}
            onChanged={() => void refresh()}
          />
        ))
      )}

      {tree.orphanProfiles.length > 0 ? (
        <Alert tone="warn" label="未归属 Profile">
          以下 Profile 的 providerId 指向不存在的 Provider，无法挂到任何卡片下：
          {tree.orphanProfiles.map((pf) => `${pf.id} → ${pf.providerId}`).join('；')}
          。请补登对应 Provider，或重新保存该 Profile 指向正确的 Provider。
        </Alert>
      ) : null}
    </PageBody>
  );
}
