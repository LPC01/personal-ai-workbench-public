import { createHash } from 'node:crypto';
import type {
  MemoryCenterPort,
  MemoryHit,
  MemoryProvider,
  MemoryResourceRecord,
  ResourceRef,
} from '@workbench/contracts';

/** 生成项目范围的资源 URI（跨项目隔离的前缀）。 */
export function projectResourceUri(projectId: string, name: string): string {
  return `project:${projectId}:${name}`;
}

/**
 * Memory 服务（26 SPEC §14.2：召回默认限定当前 Project；25 设计 §11.2 作用域）。
 * - 只读 Resource 导入：indexResource（不修改源资源）。
 * - 项目范围检索：默认限定 project scope + uri 前缀隔离，防跨项目召回。
 */
export class MemoryService {
  constructor(
    private readonly provider: MemoryProvider,
    private readonly center?: MemoryCenterPort,
  ) {}

  /** 只读导入资源（绑定项目作用域 + 来源哈希 + 敏感级别）。 */
  async importReadOnlyResource(
    projectId: string,
    name: string,
    content: string,
    options: { sensitivity?: 'public' | 'internal' | 'confidential'; sourceRefs?: string[] } = {},
  ): Promise<ResourceRef> {
    const sourceHash = createHash('sha256').update(content).digest('hex');
    const sensitivity = options.sensitivity ?? 'internal';
    const ref = await this.provider.indexResource({
      uri: projectResourceUri(projectId, name),
      content,
      scope: 'project',
      sourceHash,
      sensitivity,
      sourceRefs: options.sourceRefs,
    });
    // 投影记录：使「全量 Resources 列表」可枚举（不改变 Provider 契约）。
    this.center?.recordResource({
      uri: ref.uri,
      projectId,
      name,
      sensitivity,
      sourceHash,
      createdAt: new Date().toISOString(),
    });
    return ref;
  }

  /** 全量资源列表（项目隔离；数据源为导入时落下的工作台侧投影）。 */
  listResources(projectId?: string): MemoryResourceRecord[] {
    return this.center?.listResources({ projectId }) ?? [];
  }

  /** 项目范围检索（默认限定当前项目，跨项目需显式指定 scope）。 */
  async searchProject(projectId: string, query: string, limit = 10): Promise<MemoryHit[]> {
    const prefix = `project:${projectId}:`;
    const hits = await this.provider.search({
      query,
      scope: 'project',
      projectId,
      limit: limit * 2,
      excludedStatus: ['superseded', 'revoked'],
    });
    return hits.filter((h) => h.uri.startsWith(prefix)).slice(0, limit);
  }
}
