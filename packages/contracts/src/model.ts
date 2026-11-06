/** 数据边界（26 SPEC §12）：本地 / 云端。 */
export type DataBoundary = 'local-only' | 'cloud';

/** Provider 类型（P3-01 首期支持 openai-compatible 与 ollama）。 */
export type ModelProviderType = 'openai-compatible' | 'ollama';

/**
 * 模型 Provider（26 SPEC §12：Provider 与 ModelProfile 分离）。
 * 连接层信息，不含任何凭据（凭据只存 credentialRef，见 P3-02）。
 */
export interface ModelProvider {
  id: string;
  name: string;
  type: ModelProviderType;
  baseUrl: string | null;
  /** 凭据引用（指向 CredentialStore），可为空；真实 Secret 绝不入此表。 */
  credentialRef: string | null;
  /** 配置修订号：每次变更递增，供 Run 快照引用。 */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 模型 Profile（26 SPEC §12：providerId、modelId、能力、上下文上限、
 * 默认参数、数据边界和回退策略）。
 */
export interface ModelProfile {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  capabilities: string[];
  contextLimit: number;
  defaultParams: Record<string, unknown>;
  dataBoundary: DataBoundary;
  fallbackProfileId: string | null;
  /** 配置修订号：每次变更递增，Run 创建时固定。 */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** 创建/更新 Provider 的输入（id 存在则修订 +1，否则新建修订 1）。 */
export interface ModelProviderInput {
  id: string;
  name: string;
  type: ModelProviderType;
  baseUrl?: string;
  credentialRef?: string | null;
}

/** 创建/更新 Profile 的输入。 */
export interface ModelProfileInput {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  capabilities: string[];
  contextLimit: number;
  defaultParams?: Record<string, unknown>;
  dataBoundary: DataBoundary;
  fallbackProfileId?: string;
}
