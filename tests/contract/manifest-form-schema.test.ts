import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  draftFromManifest,
  emptyDraft,
  type ManifestDraft,
} from '../../apps/web/src/manifest-draft';

/**
 * 契约测试：登记表单（S1）产出的 manifest 必须符合 `schemas/project.schema.json`。
 *
 * 为什么要手写校验器：apps/web 不依赖 ajv，而这里要**直接对着仓库里的权威 Schema 文件**
 * 校验，避免「表单能生成、服务端判 422」。校验器覆盖本 Schema 用到的全部关键字。
 */

interface SchemaNode {
  type?: string;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, SchemaNode>;
  const?: unknown;
  enum?: unknown[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  items?: SchemaNode;
}

function check(node: SchemaNode, value: unknown, path: string, errors: string[]): void {
  if (node.const !== undefined && value !== node.const) {
    errors.push(`${path}: 期望常量 ${JSON.stringify(node.const)}，实际 ${JSON.stringify(value)}`);
    return;
  }
  if (node.enum && !node.enum.includes(value)) {
    errors.push(`${path}: 不在枚举 ${JSON.stringify(node.enum)} 内`);
  }

  switch (node.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${path}: 期望 object`);
        return;
      }
      const obj = value as Record<string, unknown>;
      for (const key of node.required ?? []) {
        if (!(key in obj)) errors.push(`${path}: 缺少必填字段 ${key}`);
      }
      const props = node.properties ?? {};
      for (const [key, item] of Object.entries(obj)) {
        const sub = props[key];
        if (!sub) {
          if (node.additionalProperties === false) errors.push(`${path}: 不允许的字段 ${key}`);
          continue;
        }
        check(sub, item, `${path}.${key}`, errors);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: 期望 array`);
        return;
      }
      const items = node.items;
      if (items) value.forEach((v, i) => check(items, v, `${path}[${i}]`, errors));
      return;
    }
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${path}: 期望 string`);
        return;
      }
      if (node.minLength !== undefined && value.length < node.minLength) {
        errors.push(`${path}: 长度需 ≥ ${node.minLength}`);
      }
      if (node.pattern && !new RegExp(node.pattern).test(value)) {
        errors.push(`${path}: 不匹配 ${node.pattern}`);
      }
      return;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${path}: 期望 integer`);
        return;
      }
      if (node.minimum !== undefined && value < node.minimum) {
        errors.push(`${path}: 需 ≥ ${node.minimum}`);
      }
      if (node.maximum !== undefined && value > node.maximum) {
        errors.push(`${path}: 需 ≤ ${node.maximum}`);
      }
      return;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') errors.push(`${path}: 期望 boolean`);
      return;
    }
    default:
      return;
  }
}

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
}

const SCHEMA = readJson('../../schemas/project.schema.json') as SchemaNode;
const REGISTRY = readJson('../../scripts/projects.registry.example.json') as unknown[];

/** 示例清单里的一条（示例服务）。 */
const SAMPLE_MANIFEST = {
  schemaVersion: 'workbench.project/v1',
  project: {
    id: 'demo-service',
    name: '示例服务',
    description: 'Node http 静态服务',
  },
  runtime: {
    root: 'C:/Projects/demo-service',
    port: { strategy: 'dynamic', from: 8120, to: 8129, environmentVariable: 'PORT' },
  },
  webUI: {
    enabled: true,
    displayMode: 'proxy',
    startCommandId: 'start',
    url: 'http://127.0.0.1:${port}/',
    healthCheck: { type: 'http', url: 'http://127.0.0.1:${port}/', timeoutSeconds: 20 },
  },
  commands: [
    {
      id: 'start',
      type: 'service',
      executable: 'node',
      arguments: ['server.mjs'],
      concurrency: 'singleton',
    },
  ],
};

const base: ManifestDraft = {
  ...emptyDraft(),
  id: 'my-app',
  name: '我的应用',
  root: 'C:/Projects/my-app',
};

const CASES: { name: string; draft: ManifestDraft }[] = [
  {
    name: '最小（全部可选区块关闭）',
    draft: { ...base, portEnabled: false, commandEnabled: false, webUIEnabled: false },
  },
  { name: '默认草稿（端口 + 命令 + Web UI 全开）', draft: base },
  { name: '仅端口段', draft: { ...base, commandEnabled: false, webUIEnabled: false } },
  { name: '仅启动命令', draft: { ...base, portEnabled: false, webUIEnabled: false } },
  { name: '仅 Web UI', draft: { ...base, portEnabled: false, commandEnabled: false } },
  { name: 'Web UI 无健康检查', draft: { ...base, webUIHealthUrl: '', webUIHealthTimeout: '' } },
  { name: '端口无环境变量', draft: { ...base, portEnvVar: '' } },
  { name: '单端口（from == to）', draft: { ...base, portFrom: '8765', portTo: '8765' } },
  {
    name: 'job 类型 + parallel 并发',
    draft: { ...base, commandType: 'job', commandConcurrency: 'parallel' },
  },
  { name: '命令无参数', draft: { ...base, commandArguments: '' } },
  { name: '带描述', draft: { ...base, description: '一段描述' } },
  { name: '反解示例清单', draft: draftFromManifest(SAMPLE_MANIFEST) },
];

describe('登记表单产出的 manifest 符合 project.schema.json', () => {
  for (const { name, draft } of CASES) {
    it(name, () => {
      const errors: string[] = [];
      check(SCHEMA, buildManifest(draft), '$', errors);
      expect(errors).toEqual([]);
    });
  }

  it('表单可表达 scripts/projects.registry.example.json 的全部示例项目', () => {
    expect(REGISTRY.length).toBeGreaterThan(0);
    for (const entry of REGISTRY) {
      const errors: string[] = [];
      check(SCHEMA, buildManifest(draftFromManifest(entry)), '$', errors);
      const label = JSON.stringify(entry).slice(0, 60);
      expect(errors, `清单条目不合规：${label}`).toEqual([]);
    }
  });

  it('校验器自身有效：能拒绝多余字段与缺失必填（防止假绿）', () => {
    const extra: string[] = [];
    check(
      SCHEMA,
      {
        schemaVersion: 'workbench.project/v1',
        project: { id: 'a-b-c', name: 'A' },
        runtime: { root: 'C:/Projects/a' },
        extra: 1,
      },
      '$',
      extra,
    );
    expect(extra.some((e) => e.includes('不允许的字段 extra'))).toBe(true);

    const missing: string[] = [];
    check(
      SCHEMA,
      { project: { id: 'a-b-c', name: 'A' }, runtime: { root: 'C:/Projects/a' } },
      '$',
      missing,
    );
    expect(missing.some((e) => e.includes('缺少必填字段 schemaVersion'))).toBe(true);

    const badId: string[] = [];
    check(
      SCHEMA,
      {
        schemaVersion: 'workbench.project/v1',
        project: { id: 'Bad_Id', name: 'A' },
        runtime: { root: 'C:/Projects/a' },
      },
      '$',
      badId,
    );
    expect(badId.some((e) => e.includes('不匹配'))).toBe(true);
  });
});
