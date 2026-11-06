import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_SCHEMA_ID, type WorkflowDefinition } from './workflow.js';
import { SchemaValidator, type ValidationResult } from './validator.js';

const SCHEMA_URL = new URL('../../../schemas/workflow.schema.json', import.meta.url);

/** workflow.v1 的 JSON Schema（从根 `schemas/` 加载，权威定义）。 */
export const workflowSchema: object = JSON.parse(
  readFileSync(fileURLToPath(SCHEMA_URL), 'utf8'),
) as object;

export type WorkflowValidator = (definition: unknown) => ValidationResult<WorkflowDefinition>;

/** 创建一个预注册 workflow schema 的验证器。 */
export function createWorkflowValidator(): WorkflowValidator {
  const validator = new SchemaValidator();
  validator.register(WORKFLOW_SCHEMA_ID, workflowSchema);
  return (definition) => validator.validate<WorkflowDefinition>(WORKFLOW_SCHEMA_ID, definition);
}
