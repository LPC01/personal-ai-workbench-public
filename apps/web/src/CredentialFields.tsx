import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Trash } from 'lucide-react';
import { describeCredential, type CredentialDescriptor } from './api';
import { Badge, Button, Field, Input } from './ui';

/** 凭据表单值：`ref` 手填引用、`secret` 明文密钥（两者由 `planCredentialUpdate` 仲裁）。 */
export interface CredentialValue {
  ref: string;
  secret: string;
}

export interface CredentialFieldsProps {
  value: CredentialValue;
  onChange: (next: CredentialValue) => void;
  /** Provider 当前已绑定的 ref：用于展示绑定状态与掩码。 */
  boundRef?: string | null;
  disabled?: boolean;
  /** 销毁凭据本体（调用方需自行先解绑 Provider，避免留下悬空引用）。 */
  onDestroy?: (ref: string) => void | Promise<void>;
}

type BindState = 'none' | 'loading' | 'ok' | 'missing';

/**
 * 凭据录入区（Provider 新建 / 编辑共用）。
 *
 * 设计约束（32 SPEC §3 CRED）：Secret 不进 SQLite、不回前端。
 * 因此明文只在用户键入到提交之间的内存里存在，提交后立即清空输入框；
 * 界面恒定只回显服务端给出的掩码。
 */
export function CredentialFields({
  value,
  onChange,
  boundRef = null,
  disabled = false,
  onDestroy,
}: CredentialFieldsProps) {
  const [reveal, setReveal] = useState(false);
  const [state, setState] = useState<BindState>(boundRef ? 'loading' : 'none');
  const [descriptor, setDescriptor] = useState<CredentialDescriptor | null>(null);

  useEffect(() => {
    if (!boundRef) {
      setState('none');
      setDescriptor(null);
      return;
    }
    let cancelled = false;
    setState('loading');
    describeCredential(boundRef)
      .then((d) => {
        if (cancelled) return;
        setDescriptor(d);
        setState('ok');
      })
      .catch(() => {
        if (cancelled) return;
        setDescriptor(null);
        setState('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [boundRef]);

  return (
    <div className="wb-group" style={{ marginTop: 'var(--wb-space-4)' }}>
      <div className="wb-probe__head">
        <KeyRound size={13} aria-hidden="true" />
        <span>凭据</span>
      </div>

      <div className="wb-cred__status" style={{ marginTop: 'var(--wb-space-2)' }}>
        {state === 'none' ? <Badge tone="neutral">未绑定</Badge> : null}
        {state === 'loading' ? <span className="wb-muted">读取凭据状态…</span> : null}
        {state === 'ok' ? (
          <>
            <Badge tone="success">已绑定</Badge>
            <code className="wb-provider__url">{boundRef}</code>
            {descriptor ? <span className="wb-chip">{descriptor.masked}</span> : null}
            {onDestroy ? (
              <Button
                size="sm"
                variant="danger-ghost"
                icon={<Trash size={12} aria-hidden="true" />}
                disabled={disabled}
                onClick={() => void onDestroy(boundRef ?? '')}
                aria-label={`销毁凭据 ${boundRef ?? ''}`}
                title="销毁后所有引用它的 Provider 都会失效"
              >
                销毁
              </Button>
            ) : null}
          </>
        ) : null}
        {state === 'missing' ? (
          <>
            <Badge tone="warn">引用失效</Badge>
            <span className="wb-muted">
              {boundRef} 已不存在（可能被销毁或非本服务登记），请重新录入密钥或更换引用。
            </span>
          </>
        ) : null}
      </div>

      <div className="wb-form-grid" style={{ marginTop: 'var(--wb-space-3)' }}>
        <Field
          label="API Key"
          hint="提交时经 /api/v1/credentials 登记，只回写引用；明文不进 SQLite，提交后立即清空本框。Windows 下由 DPAPI（CurrentUser）加密落盘，其它环境为进程内存，服务重启后需重新录入。"
        >
          <div className="wb-cred__secret">
            <Input
              type={reveal ? 'text' : 'password'}
              value={value.secret}
              onChange={(e) => onChange({ ...value, secret: e.target.value })}
              placeholder="sk-…（留空表示不更换）"
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              aria-label="Provider API Key"
            />
            <Button
              size="sm"
              variant="ghost"
              icon={reveal ? <EyeOff size={13} /> : <Eye size={13} />}
              disabled={disabled}
              onClick={() => setReveal(!reveal)}
              aria-label={reveal ? '隐藏密钥明文' : '显示密钥明文'}
              title="仅便于校对，界面永不回显已保存的密钥"
            />
          </div>
        </Field>
        <Field
          label="credentialRef（高级）"
          hint="直接填已有引用即可复用；上方录入了密钥时以其为准"
        >
          <Input
            placeholder="留空表示无需鉴权"
            value={value.ref}
            onChange={(e) => onChange({ ...value, ref: e.target.value })}
            disabled={disabled}
            aria-label="Provider credentialRef"
          />
        </Field>
      </div>
    </div>
  );
}
