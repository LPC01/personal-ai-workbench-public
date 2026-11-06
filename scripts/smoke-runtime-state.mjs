/**
 * RT-03 回归冒烟：项目运行时的「状态可信 / 打开可用 / 停止收敛」。
 *
 * 覆盖本轮修复的三个缺陷（known-limitations #19 / #20 / #24 / #25 / #26）：
 *   ① 慢启动项目启动后立刻打开 Web UI 必须真的能连上（#19 + #24）
 *   ② UNHEALTHY 之后必须能再次启动，而不是永久卡在 409「已有运行中的实例」（#25）
 *   ③ GET /runtime 必须反映服务端真实状态，而不是 start/stop 的陈旧快照（#25）
 *   ④ stop 返回时进程必须已退出、端口必须已释放（#20 + #26）
 *
 * 用法：node scripts/smoke-runtime-state.mjs   （SMOKE_PORT 可覆盖端口，默认 4130）
 * 同进程内 spawn server → 轮询就绪 → 驱动 API → kill，规避「后台进程随调用结束被杀」。
 *
 * ⚠️ 跑的是 `apps/server/dist/index.js`（编译产物），不是源码。
 * 改过 packages/** 或 apps/server/** 之后必须先 `pnpm -r build`，否则会拿着旧 dist
 * 跑出「GET /runtime 404」「stop 仍返回 STOPPING」这类假失败。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = process.cwd();
const PORT = Number(process.env.SMOKE_PORT ?? 4130);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = join(ROOT, 'var', 'smoke-runtime-state-data');
const PROJ_FAST = mkdtempSync(join(tmpdir(), 'wb-rt-fast-'));
const PROJ_SLOW = mkdtempSync(join(tmpdir(), 'wb-rt-slow-'));
const PROJ_DEAD = mkdtempSync(join(tmpdir(), 'wb-rt-dead-'));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

function manifest(id, root, script, from, timeoutSeconds) {
  return {
    schemaVersion: 'workbench.project/v1',
    project: { id, name: id },
    runtime: {
      root,
      port: { strategy: 'dynamic', from, to: from + 8, environmentVariable: 'PORT' },
    },
    webUI: {
      enabled: true,
      displayMode: 'external',
      startCommandId: 'start-web',
      healthCheck: { type: 'http', url: 'http://127.0.0.1:${port}/', timeoutSeconds },
    },
    commands: [
      {
        id: 'start-web',
        type: 'service',
        executable: 'node',
        arguments: [script],
        concurrency: 'singleton',
      },
    ],
  };
}

async function main() {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });

  writeFileSync(
    join(PROJ_FAST, 'app.mjs'),
    "import http from 'node:http';\nconst p = Number(process.env.PORT||0);\nhttp.createServer((_q,s)=>{s.writeHead(200);s.end('OK');}).listen(p,'127.0.0.1');\n",
  );
  writeFileSync(
    join(PROJ_SLOW, 'app.mjs'),
    "import http from 'node:http';\nconst p = Number(process.env.PORT||0);\nsetTimeout(()=>{http.createServer((_q,s)=>{s.writeHead(200);s.end('OK');}).listen(p,'127.0.0.1');},1500);\n",
  );
  writeFileSync(join(PROJ_DEAD, 'app.mjs'), 'setInterval(()=>{},1000);\n');

  const srv = spawn(process.execPath, [join(ROOT, 'apps', 'server', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), WB_DATA_DIR: DATA },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: ROOT,
  });
  srv.stderr.on('data', (d) => process.stderr.write(`[srv] ${d}`));

  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(300);
    try {
      up = (await fetch(`${BASE}/api/v1/projects`)).ok;
    } catch {
      /* 尚未就绪 */
    }
  }
  if (!up) throw new Error('server 未就绪');

  try {
    // ── 登记 ────────────────────────────────────────────────────────────
    for (const [id, root, script, from, t] of [
      ['rt-fast', PROJ_FAST, 'app.mjs', 20600, 5],
      ['rt-slow', PROJ_SLOW, 'app.mjs', 20620, 10],
      ['rt-dead', PROJ_DEAD, 'app.mjs', 20640, 1],
    ]) {
      const r = await api('/api/v1/projects/register', {
        method: 'POST',
        body: JSON.stringify(manifest(id, root, script, from, t)),
      });
      check(`登记 ${id}`, r.status === 200 || r.status === 201, `HTTP ${r.status}`);
    }

    // ── ① 未启动时，GET /runtime 是稳定的 STOPPED 空态 ──────────────────
    const empty = await api('/api/v1/projects/rt-fast/runtime');
    check(
      '① GET runtime 未启动 → STOPPED 空态（不是 404）',
      empty.status === 200 && empty.json?.status === 'STOPPED',
      `HTTP ${empty.status} ${JSON.stringify(empty.json)}`,
    );

    // ── ② 慢启动项目：timestampSeconds 生效，启动后立刻可访问 ───────────
    const slow = await api('/api/v1/projects/rt-slow/runtime/start', { method: 'POST' });
    check(
      '② 慢启动（1.5s）+ timeoutSeconds 10 → RUNNING',
      slow.json?.status === 'RUNNING',
      JSON.stringify(slow.json),
    );
    const slowUrl = `http://127.0.0.1:${slow.json?.port}/`;
    check(
      '② 启动返回后立刻打开项目 UI 即可连上（#24 核心）',
      slow.json?.port > 0 && (await reachable(slowUrl)),
      slowUrl,
    );

    // ── ③ GET runtime 反映真实状态 ──────────────────────────────────────
    const live = await api('/api/v1/projects/rt-slow/runtime');
    check(
      '③ GET runtime 启动后 → RUNNING 且端口一致',
      live.json?.status === 'RUNNING' && live.json?.port === slow.json?.port,
      JSON.stringify(live.json),
    );

    // ── ④ stop 返回时端口必须已释放（#20/#26） ──────────────────────────
    const stopSlow = await api('/api/v1/projects/rt-slow/runtime/stop', { method: 'POST' });
    check('④ stop → STOPPED', stopSlow.json?.status === 'STOPPED', JSON.stringify(stopSlow.json));
    check('④ stop 返回后立刻探测端口 → 不可达（进程已真退）', !(await reachable(slowUrl)), slowUrl);

    // ── ⑤ 快启动项目：停止后立即重启，不被旧进程蒙混 ────────────────────
    const s1 = await api('/api/v1/projects/rt-fast/runtime/start', { method: 'POST' });
    const p1 = s1.json?.port;
    await api('/api/v1/projects/rt-fast/runtime/stop', { method: 'POST' });
    const freed = !(await reachable(`http://127.0.0.1:${p1}/`));
    check('⑤ 停止后端口确已释放，可安全复用', freed, `port ${p1}`);
    const s2 = await api('/api/v1/projects/rt-fast/runtime/start', { method: 'POST' });
    check(
      '⑤ 停止后立即重启 → RUNNING 且新 PID（健康检查非旧进程应答）',
      s2.json?.status === 'RUNNING' &&
        s2.json?.pid !== s1.json?.pid &&
        (await reachable(`http://127.0.0.1:${s2.json?.port}/`)),
      `pid ${s1.json?.pid} → ${s2.json?.pid}, port ${s2.json?.port}`,
    );
    await api('/api/v1/projects/rt-fast/runtime/stop', { method: 'POST' });

    // ── ⑥ UNHEALTHY 之后必须能再次启动（#25） ───────────────────────────
    const d1 = await api('/api/v1/projects/rt-dead/runtime/start', { method: 'POST' });
    check('⑥ 永不监听 → UNHEALTHY', d1.json?.status === 'UNHEALTHY', JSON.stringify(d1.json));
    const d2 = await api('/api/v1/projects/rt-dead/runtime/start', { method: 'POST' });
    check(
      '⑥ UNHEALTHY 后再次启动不再 409（可自愈）',
      d2.status === 200,
      `HTTP ${d2.status} ${JSON.stringify(d2.json)}`,
    );
    const dStop = await api('/api/v1/projects/rt-dead/runtime/stop', { method: 'POST' });
    check(
      '⑥ UNHEALTHY 实例仍可被停止并收敛到 STOPPED',
      dStop.status === 200 && dStop.json?.status === 'STOPPED',
      `HTTP ${dStop.status} ${JSON.stringify(dStop.json)}`,
    );
  } finally {
    srv.kill('SIGKILL');
    await sleep(200);
    spawn('taskkill', ['/PID', String(srv.pid), '/T', '/F'], { stdio: 'ignore' });
    for (const dir of [PROJ_FAST, PROJ_SLOW, PROJ_DEAD])
      rmSync(dir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
