import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { ProjectManifest } from '@workbench/contracts';
import { AppError } from '@workbench/domain';
import { openConnection, runMigrations, migrations } from '@workbench/persistence';
import { ProjectCatalog, resolveRegistrationRoot } from '../project-catalog.js';

const tmpDirs: string[] = [];

function tmpDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'wb-pr-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  runMigrations(db, migrations);
  return db;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const validManifest: ProjectManifest = {
  schemaVersion: 'workbench.project/v1',
  project: { id: 'demo-project', name: '示例项目', description: '示例知识与方案工作台' },
  runtime: { root: '.', port: { strategy: 'dynamic', from: 8100, to: 8199 } },
  commands: [{ id: 'start-web', type: 'service', executable: 'node', arguments: ['server.js'] }],
  models: {
    defaultProfileId: 'local-general',
    allowedProfileIds: ['local-general', 'cloud-reasoning'],
  },
  memory: { defaultScope: 'project', crossProjectRecall: false },
};

describe('ProjectCatalog', () => {
  it('registers a valid manifest and returns a project', () => {
    const db = tmpDb();
    const catalog = new ProjectCatalog(db);
    const project = catalog.register(validManifest);
    expect(project.id).toBe('demo-project');
    expect(project.name).toBe('示例项目');
    expect(project.status).toBe('registered');
    expect(project.manifestHash).toHaveLength(64);
    db.close();
  });

  it('rejects an invalid manifest with MANIFEST_INVALID', () => {
    const db = tmpDb();
    const catalog = new ProjectCatalog(db);
    const bad = { ...validManifest, project: { ...validManifest.project, id: 'BAD_ID' } };
    expect(() => catalog.register(bad as unknown as ProjectManifest)).toThrow(AppError);
    try {
      catalog.register(bad as unknown as ProjectManifest);
    } catch (e) {
      expect((e as AppError).code).toBe('MANIFEST_INVALID');
    }
    db.close();
  });

  it('rejects a duplicate id with PROJECT_ALREADY_EXISTS', () => {
    const db = tmpDb();
    const catalog = new ProjectCatalog(db);
    catalog.register(validManifest);
    const dup = { ...validManifest, runtime: { root: '/other-root' } };
    try {
      catalog.register(dup);
    } catch (e) {
      expect((e as AppError).code).toBe('PROJECT_ALREADY_EXISTS');
    }
    db.close();
  });

  it('lists registered projects', () => {
    const db = tmpDb();
    const catalog = new ProjectCatalog(db);
    catalog.register(validManifest);
    const items = catalog.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('demo-project');
    db.close();
  });

  it('gets a project by id and returns undefined when missing', () => {
    const db = tmpDb();
    const catalog = new ProjectCatalog(db);
    catalog.register(validManifest);
    expect(catalog.get('demo-project')?.id).toBe('demo-project');
    expect(catalog.get('nope')).toBeUndefined();
    db.close();
  });

  it('validateManifest returns issues for invalid data without writing', () => {
    const db = tmpDb();
    const catalog = new ProjectCatalog(db);
    const result = catalog.validateManifest({ ...validManifest, schemaVersion: 'nope' });
    expect(result.valid).toBe(false);
    expect(catalog.list()).toHaveLength(0);
    db.close();
  });
});

describe('resolveRegistrationRoot', () => {
  it('returns undefined when unset or blank (no limit)', () => {
    expect(resolveRegistrationRoot({})).toBeUndefined();
    expect(resolveRegistrationRoot({ WB_PROJECTS_ROOT: '   ' })).toBeUndefined();
  });

  it('returns the trimmed value when set', () => {
    expect(resolveRegistrationRoot({ WB_PROJECTS_ROOT: '/wb/projects' })).toBe('/wb/projects');
  });
});

describe('ProjectCatalog 登记根约束（26 SPEC §5，known-limitations #11）', () => {
  function withRoot(root: string): ProjectManifest {
    return {
      ...validManifest,
      runtime: { root, port: { strategy: 'dynamic', from: 8100, to: 8199 } },
    };
  }
  function tmpRootDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'wb-root-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('未配置登记根：根外绝对路径仍可注册（向后兼容）', () => {
    const db = tmpDb();
    const catalog = new ProjectCatalog(db);
    const project = catalog.register(withRoot('/some/where/else'));
    expect(project.rootPath).toBe('/some/where/else');
    db.close();
  });

  it('配置登记根：根内绝对路径可注册', () => {
    const db = tmpDb();
    const root = tmpRootDir();
    const catalog = new ProjectCatalog(db, { registrationRoot: root });
    const project = catalog.register(withRoot(join(root, 'proj-a')));
    expect(project.rootPath).toBe(join(root, 'proj-a'));
    db.close();
  });

  it('配置登记根：相对 ` . ` 解析到登记根内，可注册', () => {
    const db = tmpDb();
    const root = tmpRootDir();
    const catalog = new ProjectCatalog(db, { registrationRoot: root });
    expect(() => catalog.register(withRoot('.'))).not.toThrow();
    db.close();
  });

  it('配置登记根：根外绝对路径 → PATH_OUTSIDE_ROOT', () => {
    const db = tmpDb();
    const root = tmpRootDir();
    const catalog = new ProjectCatalog(db, { registrationRoot: root });
    try {
      catalog.register(withRoot(tmpdir()));
    } catch (e) {
      expect((e as AppError).code).toBe('PATH_OUTSIDE_ROOT');
    }
    expect(catalog.list()).toHaveLength(0);
    db.close();
  });

  it('配置登记根：相对路径越级（..）→ PATH_OUTSIDE_ROOT', () => {
    const db = tmpDb();
    const root = join(tmpRootDir(), 'nested');
    const catalog = new ProjectCatalog(db, { registrationRoot: root });
    try {
      catalog.register(withRoot('../escape'));
    } catch (e) {
      expect((e as AppError).code).toBe('PATH_OUTSIDE_ROOT');
    }
    expect(catalog.list()).toHaveLength(0);
    db.close();
  });
});

describe('ProjectCatalog.remove 注销（26 SPEC §10.1 无 delete 端点 → 规范外扩展）', () => {
  const now = '2026-10-04T00:00:00.000Z';

  /** 造出 4 张引用表都有行的项目（模拟「跑过 Run、进过 Room」的真实项目）。 */
  function seedWithReferences(db: Database.Database, id: string): ProjectCatalog {
    const catalog = new ProjectCatalog(db);
    catalog.register({
      ...validManifest,
      project: { ...validManifest.project, id, name: id },
      runtime: { ...validManifest.runtime, root: `/tmp/${id}` },
    });
    db.prepare(
      'INSERT INTO project_commands (project_id, command_id, revision, definition_json, definition_hash) VALUES (?,?,?,?,?)',
    ).run(id, 'start-web', 1, '{}', 'hash');
    db.prepare(
      'INSERT INTO runs (id, project_id, kind, status, input_json, created_at) VALUES (?,?,?,?,?,?)',
    ).run(`run_${id}`, id, 'job', 'SUCCEEDED', '{}', now);
    db.prepare(
      'INSERT INTO run_events (run_id, sequence, event_type, payload_json, created_at) VALUES (?,?,?,?,?)',
    ).run(`run_${id}`, 1, 'state', '{}', now);
    db.prepare(
      'INSERT INTO artifacts (id, run_id, project_id, kind, logical_name, storage_ref, sha256, size_bytes, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(`art_${id}`, `run_${id}`, id, 'file', 'out.txt', 'var/artifacts/out.txt', 'abc', 1, now);
    db.prepare(
      'INSERT INTO rooms (id, name, room_type, manifest_json, manifest_hash, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(`room_${id}`, 'R', 'custom', '{}', 'h', 'ACTIVE', now, now);
    db.prepare('INSERT INTO room_projects (room_id, project_id, access_json) VALUES (?,?,?)').run(
      `room_${id}`,
      id,
      '{}',
    );
    return catalog;
  }

  it('直接删父行会被外键拦截（证明级联顺序的必要性）', () => {
    const db = tmpDb();
    seedWithReferences(db, 'demo-project');
    expect(() => db.prepare('DELETE FROM projects WHERE id = ?').run('demo-project')).toThrow(
      /FOREIGN KEY constraint failed/i,
    );
    db.close();
  });

  it('级联清理 4 张引用表并删除项目行', () => {
    const db = tmpDb();
    const catalog = seedWithReferences(db, 'demo-project');

    const cascade = catalog.remove('demo-project');

    expect(cascade).toEqual({
      roomProjects: 1,
      artifacts: 1,
      runEvents: 1,
      runs: 1,
      commands: 1,
    });
    for (const table of [
      'projects',
      'project_commands',
      'runs',
      'run_events',
      'artifacts',
      'room_projects',
    ]) {
      expect(db.prepare(`SELECT COUNT(*) c FROM ${table}`).get()).toEqual({ c: 0 });
    }
    // 房间本身不属于项目，必须保留
    expect(db.prepare('SELECT COUNT(*) c FROM rooms').get()).toEqual({ c: 1 });
    expect(catalog.get('demo-project')).toBeUndefined();
    db.close();
  });

  it('项目不存在时返回 undefined（不抛错）', () => {
    const db = tmpDb();
    const catalog = new ProjectCatalog(db);
    expect(catalog.remove('nope')).toBeUndefined();
    db.close();
  });

  it('只影响目标项目，其他项目与其引用保持不变', () => {
    const db = tmpDb();
    const catalog = seedWithReferences(db, 'demo-project');
    seedWithReferences(db, 'other-proj');

    catalog.remove('demo-project');

    expect(catalog.list().map((p) => p.id)).toEqual(['other-proj']);
    expect(db.prepare('SELECT COUNT(*) c FROM runs').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) c FROM project_commands').get()).toEqual({ c: 1 });
    db.close();
  });

  it('注销后可重新登记同一个 id（id / root 唯一性随之释放）', () => {
    const db = tmpDb();
    const catalog = seedWithReferences(db, 'demo-project');
    catalog.remove('demo-project');
    const again = catalog.register(validManifest);
    expect(again.id).toBe('demo-project');
    db.close();
  });
});

/**
 * PROJ-UI-01：列表卡片需要项目简介，来源为 manifest 的 `project.description`。
 * 该字段是可选的，回填不得破坏既有序列化（老登记未填 → 不返回该键）。
 */
describe('ProjectCatalog description 回填', () => {
  it('list / get 都回填 manifest 里的 description', () => {
    const db = tmpDb();
    const catalog = new ProjectCatalog(db);
    catalog.register(validManifest);

    expect(catalog.list()[0]?.description).toBe('示例知识与方案工作台');
    expect(catalog.get('demo-project')?.description).toBe('示例知识与方案工作台');
    db.close();
  });

  it('manifest 未填 description 时不返回该键（由前端兜底）', () => {
    const db = tmpDb();
    const catalog = new ProjectCatalog(db);
    const manifest: ProjectManifest = {
      ...validManifest,
      project: { id: 'no-desc', name: '无简介项目' },
    };
    catalog.register(manifest);

    const project = catalog.get('no-desc');
    expect(project).toBeDefined();
    expect(project?.description).toBeUndefined();
    expect('description' in (project ?? {})).toBe(false);
    db.close();
  });

  it('description 为空白串时同样视为未填', () => {
    const db = tmpDb();
    const catalog = new ProjectCatalog(db);
    catalog.register({
      ...validManifest,
      project: { id: 'blank-desc', name: '空白简介', description: '   ' },
    });

    expect(catalog.get('blank-desc')?.description).toBeUndefined();
    db.close();
  });
});
