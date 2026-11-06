import { AppError } from '@workbench/domain';
import type { ExtensionDraft } from '@workbench/contracts';
import type { ExtensionStore, ExtensionVersionRecord, StudioStore } from '@workbench/persistence';

/**
 * 草稿发布服务（26 SPEC §10.3 publish-request）：把草稿 spec 提升为
 * 内容寻址且不可变的正式版本（register → publish）。
 */
export class ExtensionPublishService {
  constructor(
    private readonly studioStore: StudioStore,
    private readonly extensionStore: ExtensionStore,
  ) {}

  publishRequest(draftId: string): { draft: ExtensionDraft; version: ExtensionVersionRecord } {
    const draft = this.studioStore.getDraft(draftId);
    if (!draft) {
      throw new AppError('EXTENSION_DRAFT_NOT_FOUND', '扩展草稿不存在', { details: { draftId } });
    }
    // 内容寻址注册 + 发布（同内容幂等返回已有版本）
    const version = this.extensionStore.register(draft.spec);
    const published = this.extensionStore.publishVersion(version.id);
    const updated = this.studioStore.updateDraftStatus(draftId, 'published');
    return { draft: updated, version: published };
  }
}
