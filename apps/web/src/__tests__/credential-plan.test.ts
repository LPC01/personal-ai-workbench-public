import { describe, expect, it } from 'vitest';
import { planCredentialUpdate } from '../credential-plan';

const base = { existingRef: null, typedRef: '', secret: '' };

describe('planCredentialUpdate', () => {
  it('录入明文 → 登记新凭据（ref 此时不可知，交给凭据 API 返回）', () => {
    const plan = planCredentialUpdate({ ...base, secret: 'sk-abc12345' });
    expect(plan.action).toBe('create');
    expect(plan.credentialRef).toBeNull();
  });

  it('明文优先于手填引用：避免「填了明文却仍绑旧引用」的静默错绑', () => {
    const plan = planCredentialUpdate({
      existingRef: 'cred_old',
      typedRef: 'cred_old',
      secret: 'sk-new',
    });
    expect(plan.action).toBe('create');
    // 反向断言：create 分支绝不允许携带任何旧 ref
    expect(plan.credentialRef).not.toBe('cred_old');
  });

  it('只手填引用且与当前不同 → 复用该引用', () => {
    const plan = planCredentialUpdate({
      existingRef: 'cred_old',
      typedRef: 'cred_new',
      secret: '',
    });
    expect(plan.action).toBe('reuse');
    expect(plan.credentialRef).toBe('cred_new');
  });

  it('手填引用与当前相同 → 维持原样', () => {
    const plan = planCredentialUpdate({ existingRef: 'cred_x', typedRef: 'cred_x', secret: '' });
    expect(plan.action).toBe('keep');
    expect(plan.credentialRef).toBe('cred_x');
  });

  it('清空引用框且原本有绑定 → 解绑（不销毁凭据本体）', () => {
    const plan = planCredentialUpdate({ existingRef: 'cred_x', typedRef: '', secret: '' });
    expect(plan.action).toBe('unbind');
    expect(plan.credentialRef).toBeNull();
  });

  it('全空且原本无绑定 → 维持「无需鉴权」', () => {
    const plan = planCredentialUpdate(base);
    expect(plan.action).toBe('keep');
    expect(plan.credentialRef).toBeNull();
  });

  it('纯空白输入按空处理', () => {
    expect(planCredentialUpdate({ existingRef: null, typedRef: '   ', secret: '  ' }).action).toBe(
      'keep',
    );
    expect(
      planCredentialUpdate({ existingRef: 'cred_x', typedRef: '  ', secret: '\t' }).action,
    ).toBe('unbind');
  });
});
