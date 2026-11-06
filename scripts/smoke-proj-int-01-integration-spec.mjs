// PROJ-INT-01 验证脚本：证明《新建项目对接规范》可用 + 模板合规。
//   第一部分：模板与登记清单经仓库权威 Schema（packages/contracts 的 Ajv 校验链）校验 + 反向断言防假绿
//   第二部分：照规范 §4 写一个全新项目，走「登记 → 启动 → RUNNING → 停止」真实全链路
// 用法：node scripts/smoke-proj-int-01-integration-spec.mjs
// 前置：packages/contracts 与 apps/server 已构建（pnpm -r build）。
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createProjectValidator } from '../packages/contracts/dist/index.js';

const REPO = resolve('.');
const API_PORT = 4070;
const BASE = `http://127.0.0.1:${API_PORT}`;
const DATA_DIR = join(REPO, 'var', 'int-01-data');
const REG_ROOT = join(REPO, 'var', 'int-01-root');
const TEMPLATE = join(REPO, 'templates', 'project', 'manifest.example.json');
const REGISTRY = join(REPO, 'scripts', 'projects.registry.example.json');

const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};
let failed = 0;
const assert = (name, cond, detail = '') => {
  log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  |  ${detail}` : ''}`);
  if (!cond) failed += 1;
};

// ═══ 第一部分：模板与登记清单的 Schema 合规性 ════════════════════════════════
log('── 1. 模板 / 登记清单 Schema 合规性 ─────────────────────────────');
const validate = createProjectValidator();
const templateRaw = JSON.parse(readFileSync(TEMPLATE, 'utf8'));

const templateResult = validate(templateRaw);
assert('templates/project/manifest.example.json 合法', templateResult.valid);

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
let registryOk = 0;
for (const item of registry) {
  if (validate(item).valid) registryOk += 1;
  else log(`   ⚠ 不合规：${item.project?.id}`);
}
assert(`登记示例全部合法`, registryOk === registry.length, `${registryOk}/${registry.length}`);

// 反向断言：证明上面的 valid 不是校验器空转
const extra = { ...templateRaw, unexpectedField: true };
assert('反向断言：多写字段必须被拒', validate(extra).valid === false);
const badId = { ...templateRaw, project: { ...templateRaw.project, id: 'Bad_ID' } };
assert('反向断言：非法 id 必须被拒', validate(badId).valid === false);
const noRuntime = { schemaVersion: templateRaw.schemaVersion, project: templateRaw.project };
assert('反向断言：缺必填 runtime 必须被拒', validate(noRuntime).valid === false);

// ═══ 第二部分：照规范写一个全新项目，走真实全链路 ════════════════════════════
log('');
log('── 2. 真实全链路（登记 → 启动 → RUNNING → 停止） ────────────────');
for (const p of [DATA_DIR, REG_ROOT]) rmSync(p, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });
const APP_DIR = join(REG_ROOT, 'demo-app');
const SLOW_DIR = join(REG_ROOT, 'demo-slow');
mkdirSync(APP_DIR, { recursive: true });
mkdirSync(SLOW_DIR, { recursive: true });

// 完全照规范 §4 R1/R2/R3/R5 写：读 PORT、/health 返 200、只绑 127.0.0.1、根路径可开
const FAST_SERVER = [
  "import { createServer } from 'node:http';",
  'const PORT = Number(process.env.PORT ?? 0);',
  'const server = createServer((req, res) => {',
  "  if (req.url === '/health') {",
  "    res.writeHead(200, { 'content-type': 'application/json' }).end('{\"status\":\"ok\"}');",
  '    return;',
  '  }',
  "  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<h1>demo-app</h1>');",
  '});',
  "server.listen(PORT, '127.0.0.1', () => console.log('demo-app listening on ' + PORT));",
].join('\n');
writeFileSync(join(APP_DIR, 'server.mjs'), FAST_SERVER);

// 慢启动：5 秒后才监听，用来验证 R4 声明的健康检查总窗口。
const SLOW_SERVER = FAST_SERVER.replace(
  'server.listen(PORT, ',
  'setTimeout(() => server.listen(PORT, ',
).replace(
  "console.log('demo-app listening on ' + PORT));",
  "console.log('demo-slow listening on ' + PORT)), 5000);",
);
writeFileSync(join(SLOW_DIR, 'server.mjs'), SLOW_SERVER);

const manifestOf = (id, name, dir, from, to, healthPath) => ({
  schemaVersion: 'workbench.project/v1',
  project: { id, name, description: 'PROJ-INT-01 冒烟样例（照规范 §4 实现）' },
  runtime: {
    root: dir.replaceAll('\\', '/'),
    port: { strategy: 'dynamic', from, to, environmentVariable: 'PORT' },
  },
  webUI: {
    enabled: true,
    displayMode: 'proxy',
    startCommandId: 'start',
    healthCheck: {
      type: 'http',
      url: `http://127.0.0.1:\${port}/${healthPath}`,
      timeoutSeconds: 30,
    },
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
});

// 起真后端（带登记根）
const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  cwd: REPO,
  env: {
    ...process.env,
    PORT: String(API_PORT),
    WB_DATA_DIR: DATA_DIR,
    WB_PROJECTS_ROOT: REG_ROOT,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
server.stdout.on('data', (c) => (serverOut += c.toString()));
server.stderr.on('data', (c) => (serverOut += c.toString()));

const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
};

try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try {
      ready = (await fetch(`${BASE}/api/v1/projects`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert(`后端在 127.0.0.1:${API_PORT} 就绪（带 WB_PROJECTS_ROOT）`, ready);
  if (!ready) throw new Error('server not ready: ' + serverOut);

  const before = await api('GET', '/api/v1/projects');
  log(`   起始项目数：${before.body.total}`);

  // 登记契约（规范 §3 / §7）
  const reg1 = await api(
    'POST',
    '/api/v1/projects/register',
    manifestOf('int-demo-app', '对接规范冒烟 · 快启', APP_DIR, 8170, 8179, 'health'),
  );
  assert('登记 demo-app → 2xx', reg1.status < 300, `status=${reg1.status}`);
  const reg2 = await api(
    'POST',
    '/api/v1/projects/register',
    manifestOf('int-demo-slow', '对接规范冒烟 · 慢启', SLOW_DIR, 8180, 8189, 'health'),
  );
  assert('登记 demo-slow → 2xx', reg2.status < 300, `status=${reg2.status}`);

  const dup = await api(
    'POST',
    '/api/v1/projects/register',
    manifestOf('int-demo-app', '对接规范冒烟 · 快启', APP_DIR, 8170, 8179, 'health'),
  );
  assert(
    '重复登记 → 409 PROJECT_ALREADY_EXISTS',
    dup.status === 409 && dup.body?.error?.code === 'PROJECT_ALREADY_EXISTS',
    `status=${dup.status} code=${dup.body?.error?.code}`,
  );

  const oob = await api(
    'POST',
    '/api/v1/projects/register',
    manifestOf('int-outside', '越界样例', 'C:/Outside/example-project', 8190, 8199, 'health'),
  );
  assert(
    '登记根外 root → 403 PATH_OUTSIDE_ROOT',
    oob.status === 403 && oob.body?.error?.code === 'PATH_OUTSIDE_ROOT',
    `status=${oob.status} code=${oob.body?.error?.code}`,
  );

  // 启动快启项目：应 RUNNING（证明「照规范写就能跑通」）
  const t0 = Date.now();
  const start = await api('POST', '/api/v1/projects/int-demo-app/runtime/start');
  const dt = Date.now() - t0;
  const port = start.body?.port;
  assert(
    '快启项目启动 → RUNNING',
    start.status < 300 && start.body?.status === 'RUNNING',
    `status=${start.status} state=${start.body?.status} port=${port} 耗时=${dt}ms`,
  );
  assert('分配到端口段 8170–8179 内', port >= 8170 && port <= 8179, `port=${port}`);

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert('健康端点 GET /health → 2xx（R2）', health.ok, `status=${health.status}`);
  const root = await fetch(`http://127.0.0.1:${port}/`);
  assert('根路径 GET / → 2xx（R5）', root.ok, `status=${root.status}`);

  const again = await api('POST', '/api/v1/projects/int-demo-app/runtime/start');
  assert(
    '运行中重复启动 → 409 RUN_STATE_CONFLICT（singleton）',
    again.status === 409 && again.body?.error?.code === 'RUN_STATE_CONFLICT',
    `status=${again.status} code=${again.body?.error?.code}`,
  );

  // R4：声明 30 秒总窗口的项目应允许 5 秒慢启动。
  const t1 = Date.now();
  const slowStart = await api('POST', '/api/v1/projects/int-demo-slow/runtime/start');
  const slowDt = Date.now() - t1;
  assert(
    '慢启项目（5s 后才监听，30s 总窗口）→ RUNNING',
    slowStart.status === 200 && slowStart.body?.status === 'RUNNING',
    `state=${slowStart.body?.status} 健康检查耗时=${slowDt}ms`,
  );
  assert(
    '健康检查等待慢启动并在声明的 30 秒窗口内完成',
    slowDt >= 4500 && slowDt < 30000,
    `实测=${slowDt}ms`,
  );

  const slowAgain = await api('POST', '/api/v1/projects/int-demo-slow/runtime/start');
  assert(
    '慢启项目运行中重复启动 → 409 RUN_STATE_CONFLICT',
    slowAgain.status === 409 && slowAgain.body?.error?.code === 'RUN_STATE_CONFLICT',
    `status=${slowAgain.status} code=${slowAgain.body?.error?.code}`,
  );

  // 停止（规范 §6）
  const stop = await api('POST', '/api/v1/projects/int-demo-app/runtime/stop');
  assert('停止快启项目 → STOPPED', stop.body?.status === 'STOPPED', `state=${stop.body?.status}`);
  const stopSlow = await api('POST', '/api/v1/projects/int-demo-slow/runtime/stop');
  assert(
    '停止慢启项目 → STOPPED',
    stopSlow.body?.status === 'STOPPED',
    `state=${stopSlow.body?.status}`,
  );

  // 独立探测端口，确认停止确实释放了服务资源。
  let released = false;
  let waited = 0;
  for (let i = 0; i < 40 && !released; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
      await new Promise((r) => setTimeout(r, 250));
      waited += 250;
    } catch {
      released = true;
    }
  }
  assert('停止后端口最终被释放', released, `port=${port} 等待=${waited}ms`);

  const after = await api('GET', '/api/v1/projects');
  assert(
    '项目列表已含两个新项目',
    after.body.total === before.body.total + 2,
    `count=${after.body.total}`,
  );
} catch (err) {
  assert('冒烟执行未抛异常', false, String(err));
} finally {
  server.kill();
}

log('');
log(failed === 0 ? 'ALL-PASS（0 失败）' : `FAILED（${failed} 项失败）`);
process.exitCode = failed === 0 ? 0 : 1;
