import type Database from 'better-sqlite3';
import type {
  ModelProfile,
  ModelProfileInput,
  ModelProvider,
  ModelProviderInput,
} from '@workbench/contracts';

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  base_url: string | null;
  credential_ref: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  id: string;
  name: string;
  provider_id: string;
  model_id: string;
  capabilities_json: string;
  context_limit: number;
  default_params_json: string;
  data_boundary: string;
  fallback_profile_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapProvider(row: ProviderRow): ModelProvider {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ModelProvider['type'],
    baseUrl: row.base_url,
    credentialRef: row.credential_ref,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProfile(row: ProfileRow): ModelProfile {
  return {
    id: row.id,
    name: row.name,
    providerId: row.provider_id,
    modelId: row.model_id,
    capabilities: JSON.parse(row.capabilities_json) as string[],
    contextLimit: row.context_limit,
    defaultParams: JSON.parse(row.default_params_json) as Record<string, unknown>,
    dataBoundary: row.data_boundary as ModelProfile['dataBoundary'],
    fallbackProfileId: row.fallback_profile_id,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 模型 Provider / Profile 存储（26 SPEC §12）：upsert 时修订号 +1。 */
export class ModelGatewayStore {
  constructor(private readonly db: Database.Database) {}

  upsertProvider(input: ModelProviderInput): ModelProvider {
    const existing = this.db
      .prepare('SELECT revision FROM model_providers WHERE id = ?')
      .get(input.id) as { revision: number } | undefined;
    const revision = (existing?.revision ?? 0) + 1;
    const now = new Date().toISOString();
    if (existing) {
      this.db
        .prepare(
          'UPDATE model_providers SET name = ?, type = ?, base_url = ?, credential_ref = ?, revision = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          input.name,
          input.type,
          input.baseUrl ?? null,
          input.credentialRef ?? null,
          revision,
          now,
          input.id,
        );
    } else {
      this.db
        .prepare(
          'INSERT INTO model_providers (id, name, type, base_url, credential_ref, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          input.id,
          input.name,
          input.type,
          input.baseUrl ?? null,
          input.credentialRef ?? null,
          revision,
          now,
          now,
        );
    }
    return this.getProvider(input.id) as ModelProvider;
  }

  listProviders(): ModelProvider[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, type, base_url, credential_ref, revision, created_at, updated_at FROM model_providers ORDER BY id',
      )
      .all() as ProviderRow[];
    return rows.map(mapProvider);
  }

  getProvider(id: string): ModelProvider | undefined {
    const row = this.db
      .prepare(
        'SELECT id, name, type, base_url, credential_ref, revision, created_at, updated_at FROM model_providers WHERE id = ?',
      )
      .get(id) as ProviderRow | undefined;
    return row ? mapProvider(row) : undefined;
  }

  upsertProfile(input: ModelProfileInput): ModelProfile {
    const existing = this.db
      .prepare('SELECT revision FROM model_profiles WHERE id = ?')
      .get(input.id) as { revision: number } | undefined;
    const revision = (existing?.revision ?? 0) + 1;
    const now = new Date().toISOString();
    const capabilities = JSON.stringify(input.capabilities);
    const defaultParams = JSON.stringify(input.defaultParams ?? {});
    if (existing) {
      this.db
        .prepare(
          `UPDATE model_profiles SET name = ?, provider_id = ?, model_id = ?, capabilities_json = ?, context_limit = ?,
           default_params_json = ?, data_boundary = ?, fallback_profile_id = ?, revision = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.name,
          input.providerId,
          input.modelId,
          capabilities,
          input.contextLimit,
          defaultParams,
          input.dataBoundary,
          input.fallbackProfileId ?? null,
          revision,
          now,
          input.id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO model_profiles (id, name, provider_id, model_id, capabilities_json, context_limit,
           default_params_json, data_boundary, fallback_profile_id, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.name,
          input.providerId,
          input.modelId,
          capabilities,
          input.contextLimit,
          defaultParams,
          input.dataBoundary,
          input.fallbackProfileId ?? null,
          revision,
          now,
          now,
        );
    }
    return this.getProfile(input.id) as ModelProfile;
  }

  listProfiles(): ModelProfile[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, provider_id, model_id, capabilities_json, context_limit, default_params_json,
         data_boundary, fallback_profile_id, revision, created_at, updated_at FROM model_profiles ORDER BY id`,
      )
      .all() as ProfileRow[];
    return rows.map(mapProfile);
  }

  getProfile(id: string): ModelProfile | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, provider_id, model_id, capabilities_json, context_limit, default_params_json,
         data_boundary, fallback_profile_id, revision, created_at, updated_at FROM model_profiles WHERE id = ?`,
      )
      .get(id) as ProfileRow | undefined;
    return row ? mapProfile(row) : undefined;
  }
}
