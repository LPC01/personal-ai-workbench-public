import { useState } from 'react';
import { Activity, Pencil, Plus, Save } from 'lucide-react';
import { probeHarnessProfile, upsertHarnessProfile, type HarnessProfile } from './api';
import {
  HARNESS_ADAPTERS,
  adapterMeta,
  parseHarnessConfig,
  validateHarnessDraft,
} from './harness-profile';
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
  Textarea,
} from './ui';

/**
 * Harness Profile 管理面板（UI-09）。
 *
 * 后端只有三个端点：`GET /harness-profiles`、`POST /harness-profiles`（upsert，
 * 同 id 再提交即 revision +1）、`POST /harness-profiles/:id/probe`。本面板只做这三件事，
 * **不提供删除**——后端没有删除端点，摆一个点了报错的按钮属于自欺。
 *
 * 如实交代的两条后端事实：
 * 1. `openai-agents` 在契约里已声明，但 Execution Gateway 的适配器工厂没有该分支，
 *    创建会成功、探测与运行必失败 —— 下拉里保留但显式标注；
 * 2. `deepseek` 缺 `baseUrl` 时构造 Adapter 即抛 `HARNESS_UNAVAILABLE`，
 *    所以在提交前就拦下，而不是等探测时才报错。
 */

export function HarnessProfilePanel({
  profiles,
  onChanged,
}: {
  profiles: HarnessProfile[];
  onChanged: (createdId?: string) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'create' | 'edit'>('idle');
  const [draftId, setDraftId] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftType, setDraftType] = useState<string>('mock');
  const [draftConfig, setDraftConfig] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openCreate() {
    const meta = adapterMeta('mock');
    setDraftId('');
    setDraftName('');
    setDraftType('mock');
    setDraftConfig(meta?.template ?? '{}');
    setError(null);
    setNotice(null);
    setMode('create');
  }

  function openEdit(p: HarnessProfile) {
    setDraftId(p.id);
    setDraftName(p.name);
    setDraftType(p.adapterType);
    setDraftConfig(JSON.stringify(p.config, null, 2));
    setError(null);
    setNotice(null);
    setMode('edit');
  }

  async function save() {
    const parsed = parseHarnessConfig(draftConfig);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const invalid = validateHarnessDraft({
      id: draftId,
      name: draftName,
      adapterType: draftType,
      config: parsed.config,
    });
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await upsertHarnessProfile({
        id: draftId.trim(),
        name: draftName.trim(),
        adapterType: draftType as HarnessProfile['adapterType'],
        config: parsed.config,
      });
      setNotice(
        mode === 'create'
          ? `已创建 ${saved.id}（revision ${saved.revision}）`
          : `已修订 ${saved.id}（revision ${saved.revision}）—— 后端为 upsert，修订号递增`,
      );
      setMode('idle');
      onChanged(saved.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function probe(id: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await probeHarnessProfile(id);
      setNotice(
        `探测 ${r.id}（${r.adapterType}）：${r.health.ok ? '可用' : `不可用${r.health.detail ? `（${r.health.detail}）` : ''}`}`,
      );
    } catch (e) {
      setError(`探测失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const currentMeta = adapterMeta(draftType);

  return (
    <Card>
      <CardHead
        title={`Harness Profile（${profiles.length}）`}
        desc="Agent 内核的连接层配置（不含凭据）。"
        actions={
          mode === 'idle' ? (
            <Button size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={openCreate}>
              新建
            </Button>
          ) : null
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      {mode === 'idle' ? (
        profiles.length === 0 ? (
          <EmptyState title="暂无 Harness Profile" desc="新建后才能发起 Agent Run。" />
        ) : (
          <ul className="wb-list">
            {profiles.map((p) => (
              <li key={p.id} className="wb-harness__row">
                <div className="wb-harness__meta">
                  <span className="wb-harness__name">{p.name}</span>
                  <span className="wb-list__sub">
                    <span className="wb-mono">{p.id}</span> · {p.adapterType} · r{p.revision}
                  </span>
                </div>
                <div className="wb-harness__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Activity size={13} aria-hidden="true" />}
                    disabled={busy}
                    onClick={() => probe(p.id)}
                  >
                    探测
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Pencil size={13} aria-hidden="true" />}
                    onClick={() => openEdit(p)}
                  >
                    修订
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="wb-col">
          <Field
            label="id"
            hint={
              mode === 'edit'
                ? '已存在的 id 不可修改：提交即修订（revision +1）'
                : '提交后不可修改；再次提交同一 id 会修订'
            }
          >
            <Input
              value={draftId}
              readOnly={mode === 'edit'}
              onChange={(e) => setDraftId(e.target.value)}
              aria-label="Harness Profile id"
              placeholder="例如 harness-mock"
            />
          </Field>

          <Field label="名称">
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              aria-label="Harness Profile 名称"
              placeholder="例如 Mock 内核"
            />
          </Field>

          <Field label="适配器类型">
            <Select
              aria-label="适配器类型"
              value={draftType}
              onChange={(e) => {
                setDraftType(e.target.value);
                setDraftConfig(adapterMeta(e.target.value)?.template ?? '{}');
              }}
            >
              {HARNESS_ADAPTERS.map((a) => (
                <option key={a.type} value={a.type}>
                  {a.label}
                  {a.implemented ? '' : '（适配器未实现）'}
                </option>
              ))}
            </Select>
          </Field>

          {currentMeta ? (
            <p className="wb-harness__hint">
              {currentMeta.hint}
              {currentMeta.implemented ? null : (
                <>
                  {' '}
                  <Badge tone="warn">创建成功但探测/运行会失败</Badge>
                </>
              )}
            </p>
          ) : null}

          <Field label="config（JSON 对象）" hint="留空视为 {}。">
            <Textarea
              aria-label="config"
              value={draftConfig}
              onChange={(e) => setDraftConfig(e.target.value)}
              rows={6}
              className="wb-mono"
            />
          </Field>

          <div className="wb-harness__actions">
            <Button
              variant="primary"
              icon={<Save size={14} aria-hidden="true" />}
              loading={busy}
              onClick={save}
            >
              {mode === 'create' ? '创建' : '提交修订'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setMode('idle')}>
              取消
            </Button>
          </div>
        </div>
      )}

      <p className="wb-harness__hint">
        后端未提供删除端点，故本面板不提供删除入口；不再需要的 Profile 只能在数据库层面处理。
      </p>
    </Card>
  );
}
