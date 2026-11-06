import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROJECT_SCHEMA_ID, type ProjectManifest } from '../project-manifest.js';
import { SchemaValidator } from '../validator.js';

function loadProjectSchema(): object {
  const url = new URL('../../../../schemas/project.schema.json', import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as object;
}

function validator(): SchemaValidator {
  const v = new SchemaValidator();
  v.register(PROJECT_SCHEMA_ID, loadProjectSchema());
  return v;
}

const validManifest: ProjectManifest = {
  schemaVersion: 'workbench.project/v1',
  project: {
    id: 'demo-project',
    name: '示例项目',
    description: '示例知识与方案工作台',
  },
  runtime: {
    root: '.',
    port: { strategy: 'dynamic', from: 8100, to: 8199, environmentVariable: 'PORT' },
  },
  webUI: {
    enabled: true,
    displayMode: 'external',
    startCommandId: 'start-web',
    stopCommandId: 'stop-web',
    url: 'http://127.0.0.1:8100',
    healthCheck: { type: 'http', url: 'http://127.0.0.1:8100/health', timeoutSeconds: 60 },
  },
  commands: [
    {
      id: 'start-web',
      type: 'service',
      executable: 'powershell.exe',
      arguments: ['-NoProfile', '-File', 'scripts/start.ps1'],
      cwd: '.',
      timeoutSeconds: 0,
      concurrency: 'singleton',
    },
  ],
  models: {
    defaultProfileId: 'local-general',
    allowedProfileIds: ['local-general', 'cloud-reasoning'],
  },
  memory: { defaultScope: 'project', crossProjectRecall: false },
};

describe('workbench.project/v1 schema', () => {
  it('accepts the SPEC §5 example manifest', () => {
    const v = validator();
    expect(v.validate(PROJECT_SCHEMA_ID, validManifest).valid).toBe(true);
  });

  it('rejects an invalid project id', () => {
    const v = validator();
    const bad = {
      ...validManifest,
      project: { ...validManifest.project, id: 'Invalid_ID' },
    } as unknown as ProjectManifest;
    expect(v.validate(PROJECT_SCHEMA_ID, bad).valid).toBe(false);
  });

  it('rejects a missing required top-level field', () => {
    const v = validator();
    const missing = {
      schemaVersion: 'workbench.project/v1',
      runtime: validManifest.runtime,
    };
    expect(v.validate(PROJECT_SCHEMA_ID, missing).valid).toBe(false);
  });

  it('rejects unknown properties (additionalProperties: false)', () => {
    const v = validator();
    const bad = { ...validManifest, extra: true } as unknown as ProjectManifest;
    expect(v.validate(PROJECT_SCHEMA_ID, bad).valid).toBe(false);
  });

  it('rejects an out-of-range port', () => {
    const v = validator();
    const bad = {
      ...validManifest,
      runtime: {
        ...validManifest.runtime,
        port: { strategy: 'dynamic', from: 1, to: 70000 },
      },
    } as unknown as ProjectManifest;
    expect(v.validate(PROJECT_SCHEMA_ID, bad).valid).toBe(false);
  });

  it('rejects an invalid displayMode', () => {
    const v = validator();
    const bad = {
      ...validManifest,
      webUI: { enabled: true, displayMode: 'invalid' },
    } as unknown as ProjectManifest;
    expect(v.validate(PROJECT_SCHEMA_ID, bad).valid).toBe(false);
  });

  it('rejects a wrong schemaVersion', () => {
    const v = validator();
    const bad = {
      ...validManifest,
      schemaVersion: 'workbench.project/v2',
    } as unknown as ProjectManifest;
    expect(v.validate(PROJECT_SCHEMA_ID, bad).valid).toBe(false);
  });
});
