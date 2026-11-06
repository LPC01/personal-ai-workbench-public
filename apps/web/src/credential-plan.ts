/**
 * Provider 凭据保存决策（纯函数，便于单测）。
 *
 * 背景：后端 `credentialRef` 只存引用，明文 Secret 走 `POST /api/v1/credentials` 单独登记。
 * 表单因此同时存在两种输入（明文密钥 / 直接填引用），必须由一处确定优先级，
 * 否则会出现「填了明文却绑定旧引用」这类静默错绑。
 */

export type CredentialPlanAction =
  /** 维持原样（含本来就无需鉴权的场景）。 */
  | 'keep'
  /** 录入了明文：先登记凭据，再把返回 ref 写回 Provider。 */
  | 'create'
  /** 直接改用别处已有的引用。 */
  | 'reuse'
  /** 清空输入框：解除绑定（只解绑 Provider，不销毁凭据本体）。 */
  | 'unbind';

export interface CredentialPlanInput {
  /** Provider 当前已绑定的 ref；新建场景为 null。 */
  existingRef: string | null;
  /** 用户手填的 ref（高级用法：复用已登记凭据）。 */
  typedRef: string;
  /** 用户输入的明文密钥。 */
  secret: string;
}

export interface CredentialPlan {
  action: CredentialPlanAction;
  /** `create` 时必然为 null：ref 要等凭据 API 返回后才可知。 */
  credentialRef: string | null;
}

/**
 * 决策优先级：**明文 > 手填引用 > 清空解绑**。
 *
 * 明文优先的理由：既然用户当场录入了密钥，意图一定是「用它」，
 * 若此时还保留旧 ref，就会形成填了却不生效的假动作。
 */
export function planCredentialUpdate(input: CredentialPlanInput): CredentialPlan {
  const secret = input.secret.trim();
  const typed = input.typedRef.trim();

  if (secret.length > 0) return { action: 'create', credentialRef: null };
  if (typed.length === 0) {
    // 输入框被清空且原本有绑定 → 解绑；原本就没有 → 保持「无需鉴权」。
    return input.existingRef
      ? { action: 'unbind', credentialRef: null }
      : { action: 'keep', credentialRef: null };
  }
  return typed === input.existingRef
    ? { action: 'keep', credentialRef: typed }
    : { action: 'reuse', credentialRef: typed };
}
