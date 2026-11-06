import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { ExtensionSpec } from '@workbench/contracts';
import { openConnection } from '../connection.js';
import { runMigrations } from '../migration-runner.js';
import { migrations } from '../migrations/index.js';
import { StudioStore } from '../studio-store.js';
import { AssistantDraftStore } from '../assistant-draft-store.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function minimalSpec(): ExtensionSpec {
  return {
    schemaVersion: 'workbench.extension/v1',
    extension: { id: 'meeting-minutes', name: 'x', version: '0.1.0', types: ['assistant'] },
    scope: { install: 'global', run: 'project' },
    permissions: { files: { read: [], write: [] }, commands: [], network: false, credentials: [] },
  };
}

function setup(): { store: AssistantDraftStore; draftId: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wb-asst-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  const session = new StudioStore(db).createSession('需求会话');
  const draft = new StudioStore(db).saveDraft(session.id, minimalSpec());
  return { store: new AssistantDraftStore(db), draftId: draft.id };
}

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()?.close();
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('AssistantDraftStore（§10.1 L1）', () => {
  it('upsert 创建并读取 Prompt + 输入输出 Schema', () => {
    const { store, draftId } = setup();
    const draft = store.upsert(draftId, {
      systemPrompt: '你是会议纪要助手',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      outputSchema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
      toolWhitelist: ['artifact.publish'],
      modelRequirements: { structuredOutput: true, minimumContextTokens: 32000 },
    });
    expect(draft.systemPrompt).toBe('你是会议纪要助手');
    expect(draft.inputSchema.required).toEqual(['text']);
    expect(draft.toolWhitelist).toEqual(['artifact.publish']);
    expect(draft.modelRequirements.structuredOutput).toBe(true);
  });

  it('upsert 同 extensionDraftId 覆盖更新', () => {
    const { store, draftId } = setup();
    store.upsert(draftId, {
      systemPrompt: 'v1',
      inputSchema: { type: 'object', properties: {}, required: [] },
      outputSchema: { type: 'object', properties: {}, required: [] },
    });
    const updated = store.upsert(draftId, {
      systemPrompt: 'v2',
      inputSchema: { type: 'object', properties: {}, required: [] },
      outputSchema: { type: 'object', properties: {}, required: [] },
    });
    expect(updated.systemPrompt).toBe('v2');
    expect(store.getByExtensionDraft(draftId)?.id).toBe(updated.id);
  });

  it('getByExtensionDraft 未找到返回 undefined', () => {
    expect(setup().store.getByExtensionDraft('nope')).toBeUndefined();
  });
});
