import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXTENSION_SCHEMA_ID, type ExtensionSpec } from './extension.js';
import { SchemaValidator, type ValidationResult } from './validator.js';

const SCHEMA_URL = new URL('../../../schemas/extension.schema.json', import.meta.url);

/** workbench.extension/v1 的 JSON Schema（从根 `schemas/` 加载，权威定义）。 */
export const extensionSchema: object = JSON.parse(
  readFileSync(fileURLToPath(SCHEMA_URL), 'utf8'),
) as object;

export type ExtensionValidator = (spec: unknown) => ValidationResult<ExtensionSpec>;

/** 创建一个预注册 extension schema 的验证器。 */
export function createExtensionValidator(): ExtensionValidator {
  const validator = new SchemaValidator();
  validator.register(EXTENSION_SCHEMA_ID, extensionSchema);
  return (spec) => validator.validate<ExtensionSpec>(EXTENSION_SCHEMA_ID, spec);
}
