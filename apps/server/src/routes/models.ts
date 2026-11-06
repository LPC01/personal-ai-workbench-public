import type { FastifyInstance } from 'fastify';
import { AppError } from '@workbench/domain';
import type { ModelProfileInput, ModelProviderInput } from '@workbench/contracts';
import {
  ModelError,
  probeProvider,
  resolveAdapter,
  resolveApiKey,
  type ChatMessage,
  type CredentialStore,
} from '@workbench/model-gateway';
import type { ModelGatewayStore } from '@workbench/persistence';
import type { CloudEgressGate } from '../cloud-egress.js';

/** Models API（26 SPEC §10.4 + 32 SPEC §3.3）：Provider / Profile 查询与 upsert + 探测/对话（鉴权 + 审批）。 */
export function registerModelRoutes(
  app: FastifyInstance,
  store: ModelGatewayStore,
  credentialStore: CredentialStore,
  egressGate?: CloudEgressGate,
): void {
  app.get('/api/v1/model-providers', async () => {
    const items = store.listProviders();
    return { items, total: items.length };
  });

  app.post('/api/v1/model-providers', async (request) => {
    return store.upsertProvider(request.body as ModelProviderInput);
  });

  app.post('/api/v1/model-providers/:id/probe', async (request) => {
    const { id } = request.params as { id: string };
    const provider = store.getProvider(id);
    if (!provider) {
      throw new AppError('MODEL_PROVIDER_NOT_FOUND', 'Provider 不存在', { details: { id } });
    }
    // 经 credentialRef 解析 apiKey（最短生命周期），错误凭据归一化为 CREDENTIAL_INVALID
    const apiKey = await resolveApiKey(provider, credentialStore);
    const result = await probeProvider(provider.type, provider.baseUrl, { apiKey });
    if (!result.healthy && /401|403/.test(result.error ?? '')) {
      throw new AppError('CREDENTIAL_INVALID', 'Provider 拒绝凭据（鉴权失败）', {
        details: { providerId: id },
      });
    }
    return result;
  });

  app.get('/api/v1/model-profiles', async () => {
    const items = store.listProfiles();
    return { items, total: items.length };
  });

  app.post('/api/v1/model-profiles', async (request) => {
    return store.upsertProfile(request.body as ModelProfileInput);
  });

  app.post('/api/v1/model-profiles/:id/chat', async (request) => {
    const { id } = request.params as { id: string };
    const profile = store.getProfile(id);
    if (!profile) {
      throw new AppError('MODEL_PROFILE_NOT_FOUND', 'Profile 不存在', { details: { id } });
    }
    const provider = store.getProvider(profile.providerId);
    if (!provider) {
      throw new AppError('MODEL_PROVIDER_NOT_FOUND', 'Provider 不存在', {
        details: { providerId: profile.providerId },
      });
    }

    // 本地数据转云端须先人工审批（32 SPEC §3.4 验收 5）
    if (profile.dataBoundary === 'cloud') {
      try {
        egressGate?.assertApproved(id);
      } catch (err) {
        if (err instanceof AppError && err.code === 'APPROVAL_REQUIRED') {
          // 无已批准审批：创建 PENDING 审批，返回 approvalId 供人工裁决
          const pending = egressGate?.requestIfCloud('cloud', id);
          throw new AppError('APPROVAL_REQUIRED', '本地数据转云端需人工审批', {
            details: { targetRef: id, approvalId: pending?.id ?? null },
          });
        }
        throw err;
      }
    }

    const body = request.body as {
      messages?: ChatMessage[];
      temperature?: number;
      maxTokens?: number;
    };
    const adapter = await resolveAdapter(provider, credentialStore);
    try {
      return await adapter.chat({
        model: profile.modelId,
        messages: body.messages ?? [],
        temperature: body.temperature,
        maxTokens: body.maxTokens,
      });
    } catch (err) {
      // 错误凭据归一化为标准鉴权错误，不泄露 Provider 原始 Secret
      if (err instanceof ModelError && err.kind === 'auth') {
        throw new AppError('CREDENTIAL_INVALID', 'Provider 拒绝凭据（鉴权失败）', {
          details: { profileId: id },
        });
      }
      throw err;
    }
  });
}
