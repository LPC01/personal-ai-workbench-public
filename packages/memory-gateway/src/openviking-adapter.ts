import { createHash } from 'node:crypto';
import { AppError } from '@workbench/domain';
import type {
  ExportBundle,
  MemoryDocument,
  MemoryHealth,
  MemoryHit,
  MemoryProvider,
  MemoryQuery,
  MemoryRef,
  ResourceInput,
  ResourceRef,
} from '@workbench/contracts';
import {
  OPENVIKING_DEFAULT_HOST,
  OPENVIKING_DEFAULT_PORT,
  OPENVIKING_PINNED_VERSION,
  type OpenVikingConfig,
} from './openviking-config.js';

/** 探测 OpenViking 健康与能力（32 号 SPEC §4.2），返回四态。 */
export async function probeOpenVikingHealth(
  baseUrl: string,
  readOnly: boolean,
  timeoutMs = 5000,
): Promise<MemoryHealth> {
  const base = (baseUrl || '').replace(/\/+$/, '');
  if (!base) {
    return { status: 'UNAVAILABLE', ok: false, detail: '未配置 baseUrl' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const get = (path: string): Promise<Response> =>
    fetch(`${base}${path}`, { signal: controller.signal });
  try {
    let live: Response;
    try {
      live = await get('/health');
    } catch (err) {
      return { status: 'UNAVAILABLE', ok: false, detail: (err as Error).message };
    }
    if (!live.ok) {
      return { status: 'UNAVAILABLE', ok: false, detail: `health HTTP ${live.status}` };
    }

    let ready: Response;
    try {
      ready = await get('/ready');
    } catch (err) {
      return { status: 'DEGRADED', ok: false, detail: (err as Error).message };
    }
    if (!ready.ok) {
      return { status: 'DEGRADED', ok: false, detail: `ready HTTP ${ready.status}` };
    }
    const data = (await ready.json()) as { status?: string };
    if (data.status !== 'ready') {
      return {
        status: 'DEGRADED',
        ok: false,
        detail: `OpenViking 未就绪: ${data.status ?? 'unknown'}`,
      };
    }

    return readOnly
      ? { status: 'READY_READONLY', ok: true, detail: 'OpenViking 就绪（只读降级）' }
      : { status: 'READY_READWRITE', ok: true, detail: 'OpenViking 就绪（读写）' };
  } finally {
    clearTimeout(timer);
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 内部 uri → OpenViking 目标 URI。
 * 内部 uri 用 `:` 分隔（如 `project:A:dataspace`），但 OpenViking 把 `to` 映射到本地
 * 目录，`:` 在 Windows 是非法字符（os error 123），故映射为 `/` 并加资源命名空间前缀。
 */
function toOpenVikingTarget(uri: string): string {
  return `viking://resources/${uri.replace(/:/g, '/')}`;
}

/**
 * OpenViking 返回 uri → 内部 uri（反向映射），供 MemoryService 的 `project:<id>:` 前缀过滤。
 * `viking://resources/project/A/dataspace/dataspace.md` → `project:A:dataspace/dataspace.md`；
 * 非 project 命名空间（user/agent 等）保持原样。
 */
function fromOpenVikingUri(vikingUri: string): string {
  const projectPrefix = 'viking://resources/project/';
  if (!vikingUri.startsWith(projectPrefix)) return vikingUri;
  const rest = vikingUri.slice('viking://resources/'.length);
  return rest.replace(/^project\/([^/]+)\//, 'project:$1:');
}

interface FindResponse {
  status?: string;
  result?: { resources?: { uri?: string; score?: number; snippet?: string }[] };
}

/**
 * OpenViking Adapter（32 号 SPEC §4 MEM）。
 * 真实 HTTP 接入（docs.openviking.ai）：health `/health`+`/ready`、索引 `POST /api/v1/resources`、
 * 语义检索 `POST /api/v1/search/find`、读取 `GET /api/v1/content/read`。
 * 认证经 `X-API-Key`；Secret 由上层经 credentialRef 解析后传入，Adapter 不长期持有明文。
 */
export class OpenVikingAdapter implements MemoryProvider {
  readonly pinnedVersion: string;
  readonly baseUrl: string;
  readonly dataDir: string;
  readonly readOnly: boolean;
  private readonly apiKey?: string;
  /** uri -> content hash，用于幂等索引。 */
  private readonly seenHashes = new Map<string, string>();

  constructor(config?: Partial<OpenVikingConfig> & { apiKey?: string }) {
    this.pinnedVersion = config?.pinnedVersion ?? OPENVIKING_PINNED_VERSION;
    this.baseUrl =
      config?.baseUrl ?? `http://${OPENVIKING_DEFAULT_HOST}:${OPENVIKING_DEFAULT_PORT}`;
    this.dataDir = config?.dataDir ?? '';
    this.readOnly = config?.readOnly ?? true;
    this.apiKey = config?.apiKey;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}),
      ...extra,
    };
  }

  /** 统一请求：网络错误归一化为 MEMORY_PROVIDER_UNAVAILABLE。 */
  private async request(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new AppError(
        'MEMORY_PROVIDER_UNAVAILABLE',
        `OpenViking 不可达: ${(err as Error).message}`,
        {},
      );
    }
  }

  async health(): Promise<MemoryHealth> {
    return probeOpenVikingHealth(this.baseUrl, this.readOnly);
  }

  async indexResource(input: ResourceInput): Promise<ResourceRef> {
    // 幂等：相同 uri + 内容 hash 不重复索引
    const hash = sha256(input.content);
    if (this.seenHashes.get(input.uri) === hash) {
      return { uri: input.uri };
    }
    // 1. temp_upload 上传内容（multipart），OpenViking 拒绝本地文件系统路径
    const name = input.uri.split(':').pop() || 'resource';
    const form = new FormData();
    form.append('file', new Blob([input.content], { type: 'text/markdown' }), `${name}.md`);
    const uploadHeaders: Record<string, string> = {};
    if (this.apiKey) uploadHeaders['X-API-Key'] = this.apiKey;
    const uploadRes = await this.request('/api/v1/resources/temp_upload', {
      method: 'POST',
      headers: uploadHeaders,
      body: form,
    });
    if (!uploadRes.ok) {
      throw new AppError('MEMORY_PROVIDER_UNAVAILABLE', `temp_upload HTTP ${uploadRes.status}`, {
        details: { uri: input.uri },
      });
    }
    const uploadData = (await uploadRes.json()) as { result?: { temp_file_id?: string } };
    const tempFileId = uploadData.result?.temp_file_id;
    if (!tempFileId) {
      throw new AppError('MEMORY_PROVIDER_UNAVAILABLE', 'temp_upload 未返回 temp_file_id', {
        details: { uri: input.uri },
      });
    }
    // 2. add_resource 引用 temp_file_id + 显式 to（`:` → `/` 映射，规避 Windows 非法字符）
    const res = await this.request('/api/v1/resources', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        temp_file_id: tempFileId,
        to: toOpenVikingTarget(input.uri),
        wait: true,
      }),
    });
    if (!res.ok) {
      throw new AppError('MEMORY_PROVIDER_UNAVAILABLE', `add_resource HTTP ${res.status}`, {
        details: { uri: input.uri },
      });
    }
    this.seenHashes.set(input.uri, hash);
    return { uri: input.uri };
  }

  async search(query: MemoryQuery): Promise<MemoryHit[]> {
    // 作用域/项目 → target_uri（viking:// 命名空间，`/` 分隔，规避 Windows 非法 `:`）
    const targetUri = query.projectId
      ? `viking://resources/project/${query.projectId}/`
      : 'viking://resources/';
    const res = await this.request('/api/v1/search/find', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ query: query.query, target_uri: targetUri, limit: query.limit ?? 10 }),
    });
    if (!res.ok) {
      throw new AppError('MEMORY_PROVIDER_UNAVAILABLE', `search HTTP ${res.status}`, {});
    }
    const data = (await res.json()) as FindResponse;
    const min = query.minimumScore;
    return (data.result?.resources ?? [])
      .map((r) => ({
        uri: fromOpenVikingUri(r.uri ?? ''),
        score: r.score ?? 0,
        snippet: r.snippet,
      }))
      .filter((h) => min === undefined || h.score >= min);
  }

  async read(uri: string): Promise<MemoryDocument> {
    const res = await this.request(`/api/v1/content/read?uri=${encodeURIComponent(uri)}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new AppError('MEMORY_PROVIDER_UNAVAILABLE', `read HTTP ${res.status}`, {
        details: { uri },
      });
    }
    const data = (await res.json()) as { content?: string } | string;
    const content = typeof data === 'string' ? data : (data.content ?? '');
    return { uri, content, scope: 'project' };
  }

  async createCandidate(): Promise<MemoryRef> {
    throw new AppError('MEMORY_PROVIDER_UNAVAILABLE', 'OpenViking 写入未接入', {});
  }

  async activate(): Promise<void> {
    throw new AppError('MEMORY_PROVIDER_UNAVAILABLE', 'OpenViking 写入未接入', {});
  }

  async supersede(): Promise<void> {
    throw new AppError('MEMORY_PROVIDER_UNAVAILABLE', 'OpenViking 写入未接入', {});
  }

  async revoke(): Promise<void> {
    throw new AppError('MEMORY_PROVIDER_UNAVAILABLE', 'OpenViking 写入未接入', {});
  }

  async export(): Promise<ExportBundle> {
    throw new AppError('MEMORY_PROVIDER_UNAVAILABLE', 'OpenViking 导出未接入', {});
  }
}
