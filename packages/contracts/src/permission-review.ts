import type { ExtensionPermissions } from './extension.js';

/** 数据流风险级别。 */
export type DataFlowRiskLevel = 'low' | 'medium' | 'high';

/** 数据流风险项。 */
export interface DataFlowRisk {
  level: DataFlowRiskLevel;
  reason: string;
}

/** 权限与数据流审阅（25 设计 §10.3「预览功能、权限和数据流」）。 */
export interface PermissionReview {
  draftId: string;
  extensionId: string;
  extensionName: string;
  /** 声明权限（来自 ExtensionSpec.permissions）。 */
  permissions: ExtensionPermissions;
  /** 数据流：读入 → 产出 + 命令/网络/凭据。 */
  dataFlow: {
    inputs: string[];
    outputs: string[];
    commands: string[];
    network: boolean;
    credentials: string[];
  };
  risks: DataFlowRisk[];
  createdAt: string;
}
