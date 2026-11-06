import { AppError } from '@workbench/domain';
import type { DataBoundary } from '@workbench/contracts';
import type { ApprovalRecord, ApprovalStore } from '@workbench/persistence';

/**
 * 本地转云端审批门（26 SPEC §12 + SEC-008）：
 * 本地数据转云端必须产生 Approval，未批准不得外发。
 */
export class CloudEgressGate {
  constructor(private readonly approvals: ApprovalStore) {}

  /** 若目标数据边界为 cloud，创建 PENDING 审批并返回；local-only 无需审批返回 undefined。 */
  requestIfCloud(
    dataBoundary: DataBoundary,
    targetRef: string,
    request: Record<string, unknown> = {},
  ): ApprovalRecord | undefined {
    if (dataBoundary !== 'cloud') {
      return undefined;
    }
    return this.approvals.create({
      actionType: 'local-to-cloud',
      targetRef,
      request,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  }

  /** 断言 targetRef 存在 APPROVED 审批，否则抛 APPROVAL_REQUIRED。 */
  assertApproved(targetRef: string): ApprovalRecord {
    const approved = this.approvals
      .list()
      .filter((a) => a.targetRef === targetRef && a.status === 'APPROVED')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    if (!approved) {
      throw new AppError('APPROVAL_REQUIRED', '本地数据转云端需人工审批', {
        details: { targetRef },
      });
    }
    return approved;
  }
}
