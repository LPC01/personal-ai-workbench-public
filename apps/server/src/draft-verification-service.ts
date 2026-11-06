import { AppError } from '@workbench/domain';
import { isHarnessTool, createExtensionValidator } from '@workbench/contracts';
import type { DraftCheckResult, DraftPreview } from '@workbench/contracts';
import type {
  AssistantDraftStore,
  DraftVerificationStore,
  StudioStore,
} from '@workbench/persistence';

/**
 * 草稿验证服务（26 SPEC §10.3 + 设计 §10.3）：build / test / eval 确定性检查 + 预览。
 *
 * 首期确定性检查（不依赖模型/真实 Builder）：
 * - build：Spec 通过 JSON Schema 校验。
 * - test：输入/输出 Schema 结构有效。
 * - eval：结构化输出要求满足、工具白名单合法、系统提示非空。
 */
export class DraftVerificationService {
  private readonly validateSpec = createExtensionValidator();

  constructor(
    private readonly studioStore: StudioStore,
    private readonly assistantStore: AssistantDraftStore,
    private readonly checks: DraftVerificationStore,
  ) {}

  build(draftId: string): DraftCheckResult {
    const draft = this.requireDraft(draftId);
    const result = this.validateSpec(draft.spec);
    const status = result.valid ? 'passed' : 'failed';
    const issues = result.valid ? [] : result.issues;
    return this.checks.record(draftId, 'build', status, {
      specValid: result.valid,
      issues,
      name: draft.spec.extension.name,
      version: draft.spec.extension.version,
    });
  }

  test(draftId: string): DraftCheckResult {
    this.requireDraft(draftId);
    const assistant = this.assistantStore.getByExtensionDraft(draftId);
    if (!assistant) {
      return this.checks.record(draftId, 'test', 'failed', {
        inputSchemaValid: false,
        outputSchemaValid: false,
        error: '缺少 Assistant 草稿',
      });
    }
    const inputValid = isObjectSchema(assistant.inputSchema);
    const outputValid = isObjectSchema(assistant.outputSchema);
    const passed = inputValid && outputValid;
    return this.checks.record(draftId, 'test', passed ? 'passed' : 'failed', {
      inputSchemaValid: inputValid,
      outputSchemaValid: outputValid,
      testCount: 2,
      passed: passed ? 2 : 0,
    });
  }

  eval(draftId: string): DraftCheckResult {
    this.requireDraft(draftId);
    const assistant = this.assistantStore.getByExtensionDraft(draftId);
    const cases: { name: string; passed: boolean }[] = [];

    if (assistant) {
      // 1. 结构化输出要求满足
      const structuredOk =
        assistant.modelRequirements.structuredOutput === true
          ? (assistant.outputSchema.required?.length ?? 0) > 0
          : true;
      cases.push({ name: 'structured-output', passed: structuredOk });

      // 2. 工具白名单合法
      const toolsOk = assistant.toolWhitelist.every((t) => isHarnessTool(t));
      cases.push({ name: 'tool-whitelist', passed: toolsOk });

      // 3. 系统提示非空
      cases.push({ name: 'system-prompt', passed: assistant.systemPrompt.trim().length > 0 });
    } else {
      cases.push({ name: 'assistant-draft', passed: false });
    }

    const passed = cases.filter((c) => c.passed).length;
    return this.checks.record(draftId, 'eval', passed === cases.length ? 'passed' : 'failed', {
      caseCount: cases.length,
      passed,
      failed: cases.length - passed,
      cases,
    });
  }

  preview(draftId: string): DraftPreview {
    const draft = this.requireDraft(draftId);
    const assistant = this.assistantStore.getByExtensionDraft(draftId);
    return {
      draftId,
      specName: draft.spec.extension.name,
      specVersion: draft.spec.extension.version,
      systemPrompt: assistant?.systemPrompt ?? null,
      toolWhitelist: assistant?.toolWhitelist ?? [],
      checks: this.checks.listByDraft(draftId),
    };
  }

  private requireDraft(draftId: string) {
    const draft = this.studioStore.getDraft(draftId);
    if (!draft) {
      throw new AppError('EXTENSION_DRAFT_NOT_FOUND', '扩展草稿不存在', { details: { draftId } });
    }
    return draft;
  }
}

function isObjectSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  const s = schema as { type?: unknown; properties?: unknown };
  return s.type === 'object' && typeof s.properties === 'object' && s.properties !== null;
}
