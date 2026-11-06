/**
 * 凭据契约（32 号 SPEC §3.2 CRED）。
 * Secret 只以 SecretMaterial 形式存在于 withSecret 闭包内，禁止序列化/记录/缓存/返回 API。
 */

export type CredentialType = 'api_key' | 'oauth' | 'password' | 'other';

/** 凭据用途（限制 withSecret 的调用场景，便于审计与授权）。 */
export type CredentialPurpose = 'model_auth' | 'provider_probe';

export type CredentialStatus = 'ACTIVE';

export interface CredentialInput {
  /** 引用名；缺省自动生成 `cred_<uuid>`。 */
  ref?: string;
  type: CredentialType;
  secret: string;
}

/** 只含引用、类型、掩码、时间与状态，绝不包含 Secret。 */
export interface CredentialDescriptor {
  ref: string;
  type: CredentialType;
  masked: string;
  createdAt: string;
  updatedAt: string;
  status: CredentialStatus;
}

/** 明文 Secret：仅闭包内使用，禁止序列化、记录、缓存到 SQLite 或返回 API。 */
export type SecretMaterial = string;
