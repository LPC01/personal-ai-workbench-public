import type { JSONSchemaType } from 'ajv';

/**
 * 示例用户契约（JSON Schema 语义，用于验证器基础设施冒烟）。
 * 真正的 Manifest / Extension / Workflow Schema 在 P1-01 / P5-01 / P6-01 引入，
 * 并落到仓库根 `schemas/` 目录。
 */
export interface ExampleUser {
  id: string;
  name: string;
}

export const EXAMPLE_USER_SCHEMA_ID = 'example.user/v1';

export const exampleUserSchema: JSONSchemaType<ExampleUser> = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
  },
  required: ['id', 'name'],
  additionalProperties: false,
};
