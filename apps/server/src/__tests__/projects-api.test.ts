import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];

function tmpDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'wb-srv-'));
  tmpDirs.push(dir);
  const db = openConnection({ path: join(dir, 'test.db') });
  runMigrations(db, migrations);
  return db;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (!dir) continue;
    try {
      // 本文件有真实 spawn 的用例：Windows 下被终止的进程可能短暂仍占用 cwd，
      // 故用重试兜底；清理失败不应把用例判红。
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* 忽略：临时目录清理失败不影响用例结论 */
    }
  }
});

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown>; requestId: string };
}

const validManifest = {
  schemaVersion: 'workbench.project/v1',
  project: { id: 'demo-project', name: '示例项目' },
  runtime: { root: '.' },
  commands: [{ id: 'start-web', type: 'service', executable: 'node' }],
};

const NODE = process.execPath;
const HTTP_SERVER =
  "require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT))";

/** 可真实拉起常驻服务的 manifest（注销的运行态用例用）。 */
function runtimeManifest(id: string, root: string, from: number, to: number) {
  return {
    schemaVersion: 'workbench.project/v1',
    project: { id, name: id },
    runtime: { root, port: { strategy: 'dynamic', from, to, environmentVariable: 'PORT' } },
    webUI: {
      enabled: true,
      displayMode: 'external',
      startCommandId: 'start-web',
      healthCheck: { type: 'http', url: 'http://127.0.0.1:${port}/', timeoutSeconds: 5 },
    },
    commands: [
      { id: 'start-web', type: 'service', executable: NODE, arguments: ['-e', HTTP_SERVER] },
    ],
  };
}

describe('projects API', () => {
  it('lists projects (empty)', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], total: 0 });
    db.close();
  });

  it('registers a project', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: validManifest,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string };
    expect(body.id).toBe('demo-project');
    db.close();
  });

  it('rejects an invalid manifest with 422', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: { ...validManifest, project: { id: 'BAD' } },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrorBody).error.code).toBe('MANIFEST_INVALID');
    db.close();
  });

  it('rejects duplicate registration with 409', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: validManifest });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: { ...validManifest, runtime: { root: '/other' } },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrorBody).error.code).toBe('PROJECT_ALREADY_EXISTS');
    db.close();
  });

  it('gets a project and returns 404 for missing', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: validManifest });
    const ok = await app.inject({ method: 'GET', url: '/api/v1/projects/demo-project' });
    expect(ok.statusCode).toBe(200);
    const missing = await app.inject({ method: 'GET', url: '/api/v1/projects/nope' });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as ErrorBody).error.code).toBe('PROJECT_NOT_FOUND');
    db.close();
  });

  it('validates a manifest via the project endpoint', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: validManifest });
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/demo-project/validate',
      payload: validManifest,
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { valid: boolean }).valid).toBe(true);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/demo-project/validate',
      payload: { ...validManifest, schemaVersion: 'nope' },
    });
    expect((bad.json() as { valid: boolean }).valid).toBe(false);
    db.close();
  });

  it('登记根约束：根内可注册，根外 403 PATH_OUTSIDE_ROOT（26 SPEC §5，known-limitations #11）', async () => {
    const db = tmpDb();
    const root = mkdtempSync(join(tmpdir(), 'wb-regroot-'));
    tmpDirs.push(root);
    const app = buildApp(db, { registrationRoot: root });

    const inside = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: { ...validManifest, runtime: { root: join(root, 'proj-a') } },
    });
    expect(inside.statusCode).toBe(200);

    const outside = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: { ...validManifest, runtime: { root: tmpdir() } },
    });
    expect(outside.statusCode).toBe(403);
    expect((outside.json() as ErrorBody).error.code).toBe('PATH_OUTSIDE_ROOT');
    db.close();
  });
});

describe('注销项目 DELETE /api/v1/projects/:projectId（26 SPEC §10.1 无 delete 端点 → 规范外扩展）', () => {
  it('级联清理 project_commands 并释放 id / root 唯一性', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: validManifest });
    expect(db.prepare('SELECT COUNT(*) c FROM project_commands').get()).toEqual({ c: 1 });

    const res = await app.inject({ method: 'DELETE', url: '/api/v1/projects/demo-project' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { removed: boolean; cascade: { commands: number } };
    expect(body.removed).toBe(true);
    expect(body.cascade.commands).toBe(1);
    expect(db.prepare('SELECT COUNT(*) c FROM projects').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM project_commands').get()).toEqual({ c: 0 });

    const list = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    expect((list.json() as { total: number }).total).toBe(0);

    // 幂等：再删同 id → 404（不是 500）
    const again = await app.inject({ method: 'DELETE', url: '/api/v1/projects/demo-project' });
    expect(again.statusCode).toBe(404);
    expect((again.json() as ErrorBody).error.code).toBe('PROJECT_NOT_FOUND');
    db.close();
  });

  it('只注销登记，不删除磁盘上的项目目录', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    const root = mkdtempSync(join(tmpdir(), 'wb-rm-root-'));
    tmpDirs.push(root);

    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: {
        ...validManifest,
        project: { id: 'keep-files', name: '保盘项目' },
        runtime: { root },
      },
    });
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/projects/keep-files' });
    expect(res.statusCode).toBe(200);
    expect(existsSync(root)).toBe(true);
    db.close();
  });

  it('运行中的项目默认 409 PROJECT_IN_USE，force=1 先停服务再注销', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    const root = mkdtempSync(join(tmpdir(), 'wb-rm-run-'));
    tmpDirs.push(root);

    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: runtimeManifest('run-before-remove', root, 20440, 20450),
    });
    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/run-before-remove/runtime/start',
    });
    expect((start.json() as { status: string }).status).toBe('RUNNING');

    const blocked = await app.inject({
      method: 'DELETE',
      url: '/api/v1/projects/run-before-remove',
    });
    expect(blocked.statusCode).toBe(409);
    const blockedBody = blocked.json() as {
      error: { code: string; details: { services: unknown[] } };
    };
    expect(blockedBody.error.code).toBe('PROJECT_IN_USE');
    expect(blockedBody.error.details.services).toHaveLength(1);
    // 被拒后项目仍在（不半删）
    expect(db.prepare('SELECT COUNT(*) c FROM projects').get()).toEqual({ c: 1 });

    const forced = await app.inject({
      method: 'DELETE',
      url: '/api/v1/projects/run-before-remove?force=1',
    });
    expect(forced.statusCode).toBe(200);
    expect((forced.json() as { stoppedServices: string[] }).stoppedServices).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) c FROM projects').get()).toEqual({ c: 0 });
    expect(existsSync(root)).toBe(true);
    // 被终止的常驻进程可能短暂仍占用 cwd（Windows），等它释放后再让 afterEach 清理
    await new Promise((resolve) => setTimeout(resolve, 600));
    db.close();
  });

  it('注销前写 manifest 快照并记录审计事件', async () => {
    const db = tmpDb();
    const dir = mkdtempSync(join(tmpdir(), 'wb-rm-data-'));
    tmpDirs.push(dir);
    const app = buildApp(db, {
      dataDirConfig: {
        dataDir: dir,
        dbPath: join(dir, 'workbench.db'),
        artifactsPath: join(dir, 'artifacts'),
      },
    });

    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: validManifest });
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/projects/demo-project' });
    expect(res.statusCode).toBe(200);

    const snapshot = (res.json() as { manifestSnapshot: string | null }).manifestSnapshot;
    expect(snapshot).not.toBeNull();
    expect(existsSync(snapshot as string)).toBe(true);

    const audit = db
      .prepare("SELECT action, target_ref FROM audit_events WHERE action = 'project.unregister'")
      .get() as { action: string; target_ref: string } | undefined;
    expect(audit?.target_ref).toBe('demo-project');
    db.close();
  });
});

/** 登记根指向真实临时目录的 manifest（README 用例需要可写的项目根目录）。 */
function readmeManifest(id: string, root: string, description?: string) {
  return {
    schemaVersion: 'workbench.project/v1',
    project: { id, name: `${id} 项目`, ...(description === undefined ? {} : { description }) },
    runtime: { root },
    commands: [{ id: 'start-web', type: 'service', executable: NODE }],
  };
}

describe('projects README 端点（PROJ-UI-01，规范外扩展）', () => {
  it('读取项目根顶层的 README.md', async () => {
    const db = tmpDb();
    const dir = mkdtempSync(join(tmpdir(), 'wb-readme-srv-'));
    tmpDirs.push(dir);
    writeFileSync(join(dir, 'README.md'), '# 标题\n\n正文内容', 'utf8');
    const app = buildApp(db);
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: readmeManifest('p-readme', dir),
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/p-readme/readme' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { found: boolean; fileName?: string; content?: string };
    expect(body.found).toBe(true);
    expect(body.fileName).toBe('README.md');
    expect(body.content).toContain('正文内容');
    await app.close();
    db.close();
  });

  it('probe=1 只回元信息，不传正文', async () => {
    const db = tmpDb();
    const dir = mkdtempSync(join(tmpdir(), 'wb-readme-srv-'));
    tmpDirs.push(dir);
    writeFileSync(join(dir, 'README.md'), '# 标题', 'utf8');
    const app = buildApp(db);
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: readmeManifest('p-probe', dir),
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/p-probe/readme?probe=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { found: boolean; sizeBytes?: number; content?: string };
    expect(body.found).toBe(true);
    expect(body.sizeBytes).toBeGreaterThan(0);
    expect(body.content).toBeUndefined();
    await app.close();
    db.close();
  });

  it('没有自述文件时是明确空态（200 + found:false），不是错误', async () => {
    const db = tmpDb();
    const dir = mkdtempSync(join(tmpdir(), 'wb-readme-srv-'));
    tmpDirs.push(dir);
    const app = buildApp(db);
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: readmeManifest('p-empty', dir),
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/p-empty/readme' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { found: boolean }).found).toBe(false);
    await app.close();
    db.close();
  });

  it('未登记的项目返回 404 PROJECT_NOT_FOUND', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/nope/readme' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as ErrorBody).error.code).toBe('PROJECT_NOT_FOUND');
    await app.close();
    db.close();
  });

  it('列表接口回填 manifest 的 description', async () => {
    const db = tmpDb();
    const dir = mkdtempSync(join(tmpdir(), 'wb-readme-srv-'));
    tmpDirs.push(dir);
    const app = buildApp(db);
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: readmeManifest('p-desc', dir, '示例知识与方案工作台'),
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    const items = (res.json() as { items: { id: string; description?: string }[] }).items;
    expect(items.find((p) => p.id === 'p-desc')?.description).toBe('示例知识与方案工作台');
    await app.close();
    db.close();
  });
});
