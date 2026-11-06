import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROJECT_SCHEMA_ID, type ProjectManifest } from './project-manifest.js';
import { SchemaValidator, type ValidationResult } from './validator.js';

const SCHEMA_URL = new URL('../../../schemas/project.schema.json', import.meta.url);

/** workbench.project/v1 的 JSON Schema（从根 `schemas/` 加载，权威定义）。 */
export const projectSchema: object = JSON.parse(
  readFileSync(fileURLToPath(SCHEMA_URL), 'utf8'),
) as object;

export type ProjectValidator = (manifest: unknown) => ValidationResult<ProjectManifest>;

/** 创建一个预注册 project schema 的验证器。 */
export function createProjectValidator(): ProjectValidator {
  const validator = new SchemaValidator();
  validator.register(PROJECT_SCHEMA_ID, projectSchema);
  return (manifest) => validator.validate<ProjectManifest>(PROJECT_SCHEMA_ID, manifest);
}
