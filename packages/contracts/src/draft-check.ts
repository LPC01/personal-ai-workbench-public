/** 草稿验证类型（26 SPEC §10.3 build/test + 设计 §10.3 eval）。 */
export type DraftCheckKind = 'build' | 'test' | 'eval';

export type DraftCheckStatus = 'passed' | 'failed';

/** 一次草稿验证结果（build / test / eval）。 */
export interface DraftCheckResult {
  id: string;
  extensionDraftId: string;
  kind: DraftCheckKind;
  status: DraftCheckStatus;
  /** 结构化报告（含失败详情）。 */
  report: Record<string, unknown>;
  createdAt: string;
}

/** 预览摘要（供人工审阅草稿 + 最近验证结果）。 */
export interface DraftPreview {
  draftId: string;
  specName: string;
  specVersion: string;
  systemPrompt: string | null;
  toolWhitelist: string[];
  checks: DraftCheckResult[];
}
