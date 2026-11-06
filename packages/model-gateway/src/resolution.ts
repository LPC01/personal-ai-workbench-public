import type { ModelProfile } from '@workbench/contracts';
import { AppError } from '@workbench/domain';

/**
 * 模型解析上下文（26 SPEC §12 + 25 设计 §12）：
 * 解析顺序 Run override > Extension default > Project default > Global default。
 */
export interface ModelResolutionContext {
  runOverrideProfileId?: string;
  extensionDefaultProfileId?: string;
  projectDefaultProfileId?: string;
  globalDefaultProfileId?: string;
}

/** 按优先级解析 profileId（第一个非空值）。 */
export function resolveModelProfileId(ctx: ModelResolutionContext): string | undefined {
  return (
    ctx.runOverrideProfileId ??
    ctx.extensionDefaultProfileId ??
    ctx.projectDefaultProfileId ??
    ctx.globalDefaultProfileId
  );
}

/**
 * 校验 Profile 能力是否满足要求（26 SPEC §12「能力不满足 Extension 要求时必须失败」）。
 * 不满足抛 `MODEL_CAPABILITY_MISMATCH`。
 */
export function assertCapabilities(
  profile: ModelProfile,
  requiredCapabilities: string[] = [],
): void {
  for (const capability of requiredCapabilities) {
    if (!profile.capabilities.includes(capability)) {
      throw new AppError('MODEL_CAPABILITY_MISMATCH', `模型 ${profile.id} 缺少能力 ${capability}`, {
        details: { profileId: profile.id, capability },
      });
    }
  }
}
