/*
 * PROJ-RM-01 真实冒烟：项目注销（移除登记）`DELETE /api/v1/projects/{id}`。
 *
 * 真实 HTTP + 真实 server + 真实 spawn 的常驻服务，验证：
 *   - 登记 → 启动服务 → RUNNING
 *   - 运行中直接注销 → 409 PROJECT_IN_USE（项目仍在，不半删）
 *   - ?force=1 → 200，服务被停止、引用被级联清理、项目消失
 *   - 磁盘上的项目目录**保留**（只注销登记）
 *   - manifest 快照落盘、审计事件落库
 *   - 结束后端口释放；幂等再注销 → 404
 *
 * 用法（须先起 server，并指向独立的干净库）：
 *   PORT=4030 WB_DATA_DIR=<abs>/data WB_PROJECTS_ROOT=C:/Projects node apps/server/dist/index.js &
 *   WB_DATA_DIR=<abs>/data node scripts/smoke-proj-rm-01-removal.mjs
 * 环境：
 *   WB_API_URL   默认 http://127.0.0.1:4030
 *   WB_DATA_DIR  服务端同一数据根（用于校验库与快照）
 *   WB_SMOKE_ID  目标项目 id，默认 demo-service（须存在于登记清单）
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.WB_API_URL ?? 'http://127.0.0.1:4030';
const DATA_DIR = resolve(process.env.WB_DATA_DIR ?? join(ROOT, 'var', 'smoke-proj-rm', 'data'));
const TARGET = process.env.WB_SMOKE_ID ?? 'demo-service';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function api(path, init) {
  const res = await fetch(API + path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/**
 * 等待端口不再监听（连接被拒 = true）。
 * `stopProcessTree` 走异步 `taskkill`，`ServiceManager.stop` 返回时进程可能尚未退出，
 * 故这里轮询等待，而非一次性判断。
 */
async function waitPortClosed(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    } catch {
      return true;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function openDb() {
  const require = createRequire(import.meta.url);
  const Database = require(join(ROOT, 'packages', 'persistence', 'node_modules', 'better-sqlite3'));
  return new Database(join(DATA_DIR, 'workbench.db'), { readonly: true });
}

async function main() {
  const registry = JSON.parse(
    readFileSync(join(ROOT, 'scripts', 'projects.registry.json'), 'utf8'),
  );
  const manifest = registry.find((m) => m?.project?.id === TARGET);
  if (!manifest) throw new Error(`登记清单里没有 ${TARGET}`);
  const projectRoot = manifest.runtime.root;

  console.log(`API       = ${API}`);
  console.log(`数据根    = ${DATA_DIR}`);
  console.log(`目标项目  = ${TARGET}（root=${projectRoot}）\n`);

  const registered = await api('/api/v1/projects/register', {
    method: 'POST',
    body: JSON.stringify(manifest),
  });
  check('登记项目 → 200', registered.status === 200, `status=${registered.status}`);

  const started = await api(`/api/v1/projects/${TARGET}/runtime/start`, { method: 'POST' });
  const port = started.body?.port;
  check(
    '启动运行时 → RUNNING（真实 spawn）',
    started.status === 200 && started.body?.status === 'RUNNING',
    `status=${started.status} runtime=${started.body?.status} port=${port}`,
  );

  const blocked = await api(`/api/v1/projects/${TARGET}`, { method: 'DELETE' });
  const blockedServices = blocked.body?.error?.details?.services ?? [];
  check(
    '运行中直接注销 → 409 PROJECT_IN_USE',
    blocked.status === 409 && blocked.body?.error?.code === 'PROJECT_IN_USE',
    `status=${blocked.status} code=${blocked.body?.error?.code} services=${blockedServices.length}`,
  );

  const stillThere = await api(`/api/v1/projects/${TARGET}`);
  check('被拒后项目仍在（不半删）', stillThere.status === 200, `status=${stillThere.status}`);

  const forced = await api(`/api/v1/projects/${TARGET}?force=1`, { method: 'DELETE' });
  check(
    'force=1 → 200 且停止服务',
    forced.status === 200 && (forced.body?.stoppedServices ?? []).length > 0,
    `status=${forced.status} stopped=${JSON.stringify(forced.body?.stoppedServices)} cascade=${JSON.stringify(forced.body?.cascade)}`,
  );

  const list = await api('/api/v1/projects');
  const ids = (list.body?.items ?? []).map((p) => p.id);
  check('注销后项目从列表消失', !ids.includes(TARGET), `剩余=${ids.length} 项`);

  check('磁盘上的项目目录保留', existsSync(projectRoot), projectRoot);

  if (port) {
    check('运行端口已释放（轮询等待）', await waitPortClosed(port), `port=${port}`);
  }

  const snapshotDir = join(DATA_DIR, 'removed-projects');
  const snapshots = existsSync(snapshotDir)
    ? readdirSync(snapshotDir).filter((f) => f.startsWith(TARGET))
    : [];
  if (snapshots.length > 0) {
    const saved = JSON.parse(readFileSync(join(snapshotDir, snapshots[0]), 'utf8'));
    check(
      'manifest 快照落盘且可原样重登记',
      saved?.project?.id === TARGET,
      `removed-projects/${snapshots[0]}`,
    );
  } else {
    check('manifest 快照落盘且可原样重登记', false, `${snapshotDir} 下无快照`);
  }

  const db = openDb();
  const projectRows = db.prepare('SELECT COUNT(*) c FROM projects WHERE id = ?').get(TARGET).c;
  const commandRows = db
    .prepare('SELECT COUNT(*) c FROM project_commands WHERE project_id = ?')
    .get(TARGET).c;
  const auditRows = db
    .prepare(
      "SELECT COUNT(*) c FROM audit_events WHERE action = 'project.unregister' AND target_ref = ?",
    )
    .get(TARGET).c;
  db.close();
  check(
    '库内 projects / project_commands 引用已清零',
    projectRows === 0 && commandRows === 0,
    `projects=${projectRows} project_commands=${commandRows}`,
  );
  check('审计事件 project.unregister 已落库', auditRows > 0, `rows=${auditRows}`);

  const again = await api(`/api/v1/projects/${TARGET}`, { method: 'DELETE' });
  check(
    '幂等：再注销 → 404 PROJECT_NOT_FOUND',
    again.status === 404 && again.body?.error?.code === 'PROJECT_NOT_FOUND',
    `status=${again.status} code=${again.body?.error?.code}`,
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n== ${passed}/${results.length} checks passed ==`);
  if (passed !== results.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
