/**
 * SDD 开发交付协议状态机（29 号 SPEC §14）。
 * domain 包保持纯净，不依赖 contracts。
 */

/** SDD 交付协议固定阶段（§14）。 */
export type SddStage =
  | 'INTAKE'
  | 'SPEC_DRAFT'
  | 'SPEC_REVIEW'
  | 'WAITING_SPEC_APPROVAL'
  | 'IMPLEMENTATION'
  | 'VERIFICATION'
  | 'INDEPENDENT_REVIEW'
  | 'DECISION'
  | 'ARCHIVE';

/** 阶段线性顺序（§14 固定阶段）。 */
export const SDD_STAGES: readonly SddStage[] = [
  'INTAKE',
  'SPEC_DRAFT',
  'SPEC_REVIEW',
  'WAITING_SPEC_APPROVAL',
  'IMPLEMENTATION',
  'VERIFICATION',
  'INDEPENDENT_REVIEW',
  'DECISION',
  'ARCHIVE',
];

/** 终态（ARCHIVE，归档后才允许生成 Memory Candidate）。 */
export const SDD_TERMINAL: ReadonlySet<SddStage> = new Set(['ARCHIVE']);

/** 评审结论。 */
export type ReviewDecision = 'ACCEPTED' | 'REWORK' | 'REJECTED';

/** 阶段推进门禁上下文。 */
export interface SddGateContext {
  specApproved: boolean;
  reviewDecision?: ReviewDecision;
  hasFinalArtifact: boolean;
}

/** 下一阶段（线性）；终态返回 null。 */
export function nextSddStage(stage: SddStage): SddStage | null {
  const idx = SDD_STAGES.indexOf(stage);
  return idx >= 0 && idx < SDD_STAGES.length - 1 ? (SDD_STAGES[idx + 1] ?? null) : null;
}

/**
 * 阶段推进门禁（§14）：返回阻止推进的原因或 null。
 * - WAITING_SPEC_APPROVAL：未批准 Spec 不得进入 IMPLEMENTATION；
 * - INDEPENDENT_REVIEW：测试失败/Secret 泄露/路径越界/权限扩大未批准 → REWORK/REJECTED；
 * - DECISION：必须生成 ADR/验收记录/发布说明 Artifact；
 * - ARCHIVE 为终态，不可推进。
 */
export function assertSddGate(stage: SddStage, ctx: SddGateContext): string | null {
  if (SDD_TERMINAL.has(stage)) return `阶段 ${stage} 为终态，不可推进`;
  switch (stage) {
    case 'WAITING_SPEC_APPROVAL':
      return ctx.specApproved ? null : '未批准 Spec 不得进入 IMPLEMENTATION';
    case 'INDEPENDENT_REVIEW':
      if (ctx.reviewDecision === 'REWORK') {
        return '测试失败/Secret 泄露/路径越界/权限扩大未批准，判定 REWORK 需返工';
      }
      if (ctx.reviewDecision === 'REJECTED') return '判定 REJECTED';
      return null;
    case 'DECISION':
      return ctx.hasFinalArtifact ? null : '最终 Decision 必须生成 ADR/验收记录/发布说明 Artifact';
    default:
      return null;
  }
}

/** 推进到下一阶段（含门禁校验）。返回 { next } 或 { error }。 */
export function advanceSddStage(
  stage: SddStage,
  ctx: SddGateContext,
): { next: SddStage } | { error: string } {
  const gate = assertSddGate(stage, ctx);
  if (gate) return { error: gate };
  const next = nextSddStage(stage);
  if (!next) return { error: `阶段 ${stage} 无法推进` };
  return { next };
}
