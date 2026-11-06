import { AppError } from '@workbench/domain';
import type { ExtensionDraft, ExtensionSpec, ExtensionType } from '@workbench/contracts';
import type { StudioStore } from '@workbench/persistence';

/**
 * Studio 服务（26 SPEC §10.3 + 设计 §6.6）：需求对话 → 生成版本化 Extension Spec 草稿。
 *
 * `generateSpec` 为确定性推导（首期不依赖模型调用）：
 * 从会话标题推导 id/name，从需求文本识别类型（含「工作流」→ workflow，否则 assistant）。
 */
export class StudioService {
  constructor(private readonly store: StudioStore) {}

  generateSpec(sessionId: string): ExtensionDraft {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new AppError('STUDIO_SESSION_NOT_FOUND', 'Studio Session 不存在', {
        details: { sessionId },
      });
    }
    const requirement = this.store
      .listMessages(sessionId)
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');

    const spec = this.deriveSpec(sessionId, session.title, requirement);
    const draft = this.store.saveDraft(sessionId, spec);
    this.store.updateSessionStatus(sessionId, 'spec-generated');
    return draft;
  }

  private deriveSpec(sessionId: string, title: string, requirement: string): ExtensionSpec {
    const types: ExtensionType[] = requirement.includes('工作流') ? ['workflow'] : ['assistant'];
    return {
      schemaVersion: 'workbench.extension/v1',
      extension: { id: this.deriveId(sessionId, title), name: title, version: '0.1.0', types },
      scope: { install: 'global', run: 'project' },
      permissions: {
        files: { read: ['inputs/**'], write: ['artifacts/**'] },
        commands: [],
        network: false,
        credentials: [],
      },
      model: { defaultProfileId: 'local-general' },
    };
  }

  private deriveId(sessionId: string, title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (slug.length >= 3 && /^[a-z]/.test(slug)) {
      return slug;
    }
    // 中文标题等无法转拼音：从 sessionId 派生稳定小写 id
    const hex = sessionId.replace(/[^a-z0-9]/g, '').slice(0, 20);
    return `ext-${hex}`;
  }
}
