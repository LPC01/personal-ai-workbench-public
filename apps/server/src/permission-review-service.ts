import { AppError } from '@workbench/domain';
import type { DataFlowRisk, PermissionReview } from '@workbench/contracts';
import type { StudioStore } from '@workbench/persistence';

/**
 * 权限与数据流审阅服务（25 设计 §10.3）：从 ExtensionSpec.permissions 确定性推导
 * 数据流（读入 → 产出 + 命令/网络/凭据）与风险等级。
 */
export class PermissionReviewService {
  constructor(private readonly studioStore: StudioStore) {}

  review(draftId: string): PermissionReview {
    const draft = this.studioStore.getDraft(draftId);
    if (!draft) {
      throw new AppError('EXTENSION_DRAFT_NOT_FOUND', '扩展草稿不存在', { details: { draftId } });
    }
    const permissions = draft.spec.permissions;
    const risks: DataFlowRisk[] = [];

    if (permissions.network) {
      risks.push({ level: 'high', reason: '声明网络访问，需人工确认数据外发边界' });
    }
    if (permissions.credentials.length > 0) {
      risks.push({
        level: 'high',
        reason: `声明使用凭据（${permissions.credentials.join(', ')}）`,
      });
    }
    if (permissions.commands.length > 0) {
      risks.push({ level: 'medium', reason: `声明命令执行（${permissions.commands.length} 个）` });
    }
    if (permissions.files.write.length > 0) {
      risks.push({ level: 'medium', reason: '声明写文件路径，需确认限定在受控根内' });
    }
    if (risks.length === 0) {
      risks.push({ level: 'low', reason: '仅读入受限路径，无网络/命令/凭据' });
    }

    return {
      draftId,
      extensionId: draft.spec.extension.id,
      extensionName: draft.spec.extension.name,
      permissions,
      dataFlow: {
        inputs: permissions.files.read,
        outputs: permissions.files.write,
        commands: permissions.commands,
        network: permissions.network,
        credentials: permissions.credentials,
      },
      risks,
      createdAt: new Date().toISOString(),
    };
  }
}
