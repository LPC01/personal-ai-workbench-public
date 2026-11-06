import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { migrations, openConnection, runMigrations } from '@workbench/persistence';
import { buildApp } from '../app.js';

const tmpDirs: string[] = [];

function tmpDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'wb-rt-'));
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

const NODE = process.execPath;
const HTTP_SERVER =
  "require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT))";

const manifest = {
  schemaVersion: 'workbench.project/v1',
  project: { id: 'demo-project', name: '示例项目' },
  runtime: {
    root: '.',
    port: { strategy: 'dynamic', from: 20400, to: 20410, environmentVariable: 'PORT' },
  },
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

describe('runtime API', () => {
  it('starts and stops a project runtime', async () => {
    const db = tmpDb();
    const app = buildApp(db);

    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: manifest });

    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/demo-project/runtime/start',
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as { status: string; port: number };
    expect(startBody.status).toBe('RUNNING');
    expect(startBody.port).toBeGreaterThanOrEqual(20400);

    const stop = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/demo-project/runtime/stop',
    });
    expect(stop.statusCode).toBe(200);
    expect((stop.json() as { status: string }).status).toBe('STOPPED');

    db.close();
  });

  it('returns 404 for a missing project', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/nope/runtime/start' });
    expect(res.statusCode).toBe(404);
    db.close();
  });

  it('rejects a start whose executable is not on the allowlist', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    const root = mkdtempSync(join(tmpdir(), 'wb-rt-root-'));
    tmpDirs.push(root);

    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: {
        schemaVersion: 'workbench.project/v1',
        project: { id: 'evil-exec', name: '越权程序' },
        runtime: { root },
        webUI: { enabled: true, displayMode: 'external', startCommandId: 'start-web' },
        commands: [{ id: 'start-web', type: 'service', executable: 'calc.exe' }],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/evil-exec/runtime/start',
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('COMMAND_NOT_REGISTERED');
    db.close();
  });

  it('rejects a start whose cwd escapes the controlled root', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    const root = mkdtempSync(join(tmpdir(), 'wb-rt-root-'));
    tmpDirs.push(root);

    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: {
        schemaVersion: 'workbench.project/v1',
        project: { id: 'escape-cwd', name: '越界 cwd' },
        runtime: { root },
        webUI: { enabled: true, displayMode: 'external', startCommandId: 'start-web' },
        commands: [
          {
            id: 'start-web',
            type: 'service',
            executable: NODE,
            arguments: ['-e', HTTP_SERVER],
            cwd: join('..', '..'),
          },
        ],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/escape-cwd/runtime/start',
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('PATH_OUTSIDE_ROOT');
    db.close();
  });

  it('rejects a second start when the service command is singleton', async () => {
    const db = tmpDb();
    const app = buildApp(db);

    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: {
        schemaVersion: 'workbench.project/v1',
        project: { id: 'singleton-web', name: '单例 Web' },
        runtime: {
          root: '.',
          port: { strategy: 'dynamic', from: 20420, to: 20430, environmentVariable: 'PORT' },
        },
        webUI: {
          enabled: true,
          displayMode: 'external',
          startCommandId: 'start-web',
          healthCheck: { type: 'http', url: 'http://127.0.0.1:${port}/', timeoutSeconds: 5 },
        },
        commands: [
          {
            id: 'start-web',
            type: 'service',
            executable: NODE,
            arguments: ['-e', HTTP_SERVER],
            concurrency: 'singleton',
          },
        ],
      },
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/singleton-web/runtime/start',
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { status: string }).status).toBe('RUNNING');

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/singleton-web/runtime/start',
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe('RUN_STATE_CONFLICT');

    // 停止后可再次启动（singleton 不是永久锁）。
    await app.inject({ method: 'POST', url: '/api/v1/projects/singleton-web/runtime/stop' });
    const third = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/singleton-web/runtime/start',
    });
    expect(third.statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/v1/projects/singleton-web/runtime/stop' });

    db.close();
  });

  // ── RT-03 ────────────────────────────────────────────────────────────────
  it('GET runtime reports the live status instead of a stale snapshot (#25)', async () => {
    const db = tmpDb();
    const app = buildApp(db);

    await app.inject({ method: 'POST', url: '/api/v1/projects/register', payload: manifest });

    // 未启动：稳定的 STOPPED 空态，而不是 404
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/demo-project/runtime',
    });
    expect(before.statusCode).toBe(200);
    expect((before.json() as { status: string }).status).toBe('STOPPED');

    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/demo-project/runtime/start',
    });
    const started = start.json() as { port: number };

    const during = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/demo-project/runtime',
    });
    expect((during.json() as { status: string; port: number }).status).toBe('RUNNING');
    expect((during.json() as { port: number }).port).toBe(started.port);

    await app.inject({ method: 'POST', url: '/api/v1/projects/demo-project/runtime/stop' });

    const after = await app.inject({ method: 'GET', url: '/api/v1/projects/demo-project/runtime' });
    expect((after.json() as { status: string }).status).toBe('STOPPED');

    db.close();
  });

  it('GET runtime returns 404 for a missing project', async () => {
    const db = tmpDb();
    const app = buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/nope/runtime' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('PROJECT_NOT_FOUND');
    db.close();
  });

  it('allows a restart after UNHEALTHY, because it releases process and port (#25)', async () => {
    const db = tmpDb();
    const app = buildApp(db);

    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: {
        schemaVersion: 'workbench.project/v1',
        project: { id: 'unhealthy-web', name: '启动失败的项目' },
        runtime: {
          root: '.',
          port: { strategy: 'dynamic', from: 20460, to: 20470, environmentVariable: 'PORT' },
        },
        webUI: {
          enabled: true,
          displayMode: 'external',
          startCommandId: 'start-web',
          healthCheck: { type: 'http', url: 'http://127.0.0.1:${port}/', timeoutSeconds: 1 },
        },
        commands: [
          {
            id: 'start-web',
            type: 'service',
            // 永不监听端口 → 健康检查必然失败
            executable: NODE,
            arguments: ['-e', 'setInterval(()=>{},1000)'],
            concurrency: 'singleton',
          },
        ],
      },
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/unhealthy-web/runtime/start',
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { status: string }).status).toBe('UNHEALTHY');

    // 关键回归：UNHEALTHY 后必须能再次启动，而不是永久卡在 409「已有运行中的实例」
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/unhealthy-web/runtime/start',
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { status: string }).status).toBe('UNHEALTHY');

    // 停止也不能因为「已经回收过」而报错：返回终态即视为已停止
    const stop = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/unhealthy-web/runtime/stop',
    });
    expect(stop.statusCode).toBe(200);
    expect((stop.json() as { status: string }).status).toBe('STOPPED');

    db.close();
  });

  it('makes the health-check window follow timeoutSeconds (#19/#24)', async () => {
    const db = tmpDb();
    const app = buildApp(db);

    // 1.5 秒后才监听：旧实现（约 2 秒固定窗口 + 单次超时占满）容易误判为 UNHEALTHY
    const late =
      "setTimeout(()=>require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT)),1500)";
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/register',
      payload: {
        schemaVersion: 'workbench.project/v1',
        project: { id: 'slow-web', name: '慢启动项目' },
        runtime: {
          root: '.',
          port: { strategy: 'dynamic', from: 20480, to: 20490, environmentVariable: 'PORT' },
        },
        webUI: {
          enabled: true,
          displayMode: 'external',
          startCommandId: 'start-web',
          healthCheck: { type: 'http', url: 'http://127.0.0.1:${port}/', timeoutSeconds: 10 },
        },
        commands: [{ id: 'start-web', type: 'service', executable: NODE, arguments: ['-e', late] }],
      },
    });

    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/slow-web/runtime/start',
    });
    expect(start.statusCode).toBe(200);
    const body = start.json() as { status: string; port: number };
    expect(body.status).toBe('RUNNING');

    // 通过了健康检查，此刻打开项目 UI 必须真的能连上（#24 的核心诉求）
    const probe = await fetch(`http://127.0.0.1:${body.port}/`);
    expect(probe.ok).toBe(true);

    await app.inject({ method: 'POST', url: '/api/v1/projects/slow-web/runtime/stop' });
    db.close();
  });
});
