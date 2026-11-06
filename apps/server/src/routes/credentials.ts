import type { FastifyInstance } from 'fastify';
import { AppError } from '@workbench/domain';
import type { CredentialStore } from '@workbench/model-gateway';
import type { AuditStore } from '@workbench/persistence';

const CREDENTIAL_TYPES = new Set(['api_key', 'oauth', 'password', 'other']);

/** 凭据 API（32 号 SPEC §3.3）：只返回 descriptor，绝不返回明文 Secret。 */
export function registerCredentialRoutes(
  app: FastifyInstance,
  store: CredentialStore,
  auditStore?: AuditStore,
): void {
  app.post('/api/v1/credentials', async (request) => {
    const body = request.body as { ref?: string; type?: unknown; secret?: unknown };
    if (typeof body?.secret !== 'string' || body.secret.length === 0) {
      throw new AppError('CREDENTIAL_INVALID', 'secret 必须为非空字符串', {});
    }
    const type = (body.type as string) ?? 'api_key';
    if (!CREDENTIAL_TYPES.has(type)) {
      throw new AppError('CREDENTIAL_INVALID', 'type 非法', { details: { type } });
    }
    const descriptor = await store.put({
      ref: body.ref,
      type: type as 'api_key' | 'oauth' | 'password' | 'other',
      secret: body.secret,
    });
    auditStore?.record('system', 'credential.create', descriptor.ref);
    return descriptor;
  });

  app.get('/api/v1/credentials/:ref', async (request) => {
    const { ref } = request.params as { ref: string };
    return store.describe(ref);
  });

  app.delete('/api/v1/credentials/:ref', async (request) => {
    const { ref } = request.params as { ref: string };
    await store.delete(ref);
    auditStore?.record('system', 'credential.delete', ref);
    return { deleted: ref };
  });
}
