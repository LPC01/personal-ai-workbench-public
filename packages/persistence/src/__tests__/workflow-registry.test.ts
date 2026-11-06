import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { WorkflowDefinition } from '@workbench/contracts';
import { openConnection } from '../connection.js';
import { runMigrations } from '../migration-runner.js';
import { migrations } from '../migrations/index.js';
import { WorkflowRegistry } from '../workflow-registry.js';

const tmpDirs: string[] = [];
const openDbs: Database.Database[] = [];

function newRegistry(): WorkflowRegistry {
  const dir = mkdtempSync(join(tmpdir(), 'wb-wf-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  openDbs.push(db);
  runMigrations(db, migrations);
  return new WorkflowRegistry(db);
}

function definition(version = '0.1.0'): WorkflowDefinition {
  return {
    schemaVersion: 'workflow.v1',
    id: 'meeting-flow',
    name: '会议纪要流程',
    version,
    nodes: [
      { id: 'in', type: 'input' },
      { id: 'out', type: 'output' },
    ],
  };
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

describe('WorkflowRegistry（§7 内容寻址）', () => {
  it('register 记录定义 + 内容哈希', () => {
    const registry = newRegistry();
    const rec = registry.register(definition());
    expect(rec.definitionId).toBe('meeting-flow');
    expect(rec.contentHash).toHaveLength(64);
  });

  it('同内容 register 幂等返回同一记录', () => {
    const registry = newRegistry();
    const a = registry.register(definition());
    const b = registry.register(definition());
    expect(b.id).toBe(a.id);
    expect(registry.list()).toHaveLength(1);
  });

  it('不同版本生成新记录，getByDefinition 可查', () => {
    const registry = newRegistry();
    registry.register(definition('0.1.0'));
    const v2 = registry.register(definition('0.2.0'));
    expect(registry.list()).toHaveLength(2);
    expect(registry.getByDefinition('meeting-flow', '0.2.0')?.id).toBe(v2.id);
  });
});
