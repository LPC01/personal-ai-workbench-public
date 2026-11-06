import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';

/** 单条校验问题，与 SPEC §10 错误语义对齐（具体错误码映射在 P0-06 完成）。 */
export interface ValidationIssue {
  /** 出错的实例路径，如 `/name` 或 `/` */
  instancePath: string;
  /** 对应 Schema 路径 */
  schemaPath: string;
  /** 校验关键字，如 required / type / minLength */
  keyword: string;
  /** 人类可读的失败信息 */
  message: string;
  /** 关键字附带的参数 */
  params: Record<string, unknown>;
}

export type ValidationResult<T> =
  { valid: true; value: T } | { valid: false; issues: ValidationIssue[] };

export interface SchemaValidatorOptions {
  /** 是否启用 Ajv strict 模式（拒绝非标准关键字），默认 true */
  strict?: boolean;
  /** 是否收集全部错误（而非首个），默认 true */
  allErrors?: boolean;
}

/**
 * 通用 JSON Schema 验证器（Ajv 封装）。
 * 所有外部契约（Manifest / Extension / Workflow 等）通过 register 注册后统一 validate。
 */
export class SchemaValidator {
  private readonly ajv: Ajv;
  private readonly compiled = new Map<string, ValidateFunction>();

  constructor(options: SchemaValidatorOptions = {}) {
    this.ajv = new Ajv({
      allErrors: options.allErrors ?? true,
      strict: options.strict ?? true,
      removeAdditional: false,
      useDefaults: false,
    });
  }

  /** 注册一个 Schema；id 必须唯一，重复注册抛错。 */
  register(id: string, schema: object): void {
    if (this.compiled.has(id)) {
      throw new Error(`Schema already registered: ${id}`);
    }
    this.compiled.set(id, this.ajv.compile(schema));
  }

  has(id: string): boolean {
    return this.compiled.has(id);
  }

  /** 校验数据；Schema 未注册时抛错，校验失败返回结构化 issues。 */
  validate<T = unknown>(id: string, data: unknown): ValidationResult<T> {
    const validate = this.compiled.get(id);
    if (!validate) {
      throw new Error(`Schema not registered: ${id}`);
    }
    if (validate(data)) {
      return { valid: true, value: data as T };
    }
    const issues: ValidationIssue[] = (validate.errors ?? []).map((e) => ({
      instancePath: e.instancePath || '/',
      schemaPath: e.schemaPath,
      keyword: e.keyword,
      message: e.message ?? 'validation failed',
      params: (e.params ?? {}) as Record<string, unknown>,
    }));
    return { valid: false, issues };
  }
}
