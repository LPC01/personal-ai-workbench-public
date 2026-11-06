/*
 * RT-02 真实冒烟：`ProjectCommand.concurrency`（26 SPEC §5）接线验证。
 *
 * 真实 HTTP + 真实 spawn：`singleton` 命令并发第二次必须被拒（FAILED / RUN_STATE_CONFLICT），
 * 终态后可再次启动；`parallel` 命令允许并发。
 *
 * 用法（须先起后端，例：PORT=4000 WB_DATA_DIR=<abs> node apps/server/dist/index.js）：
 *   node scripts/smoke-rt02-concurrency.mjs
 * 环境：
 *   WB_API_URL   默认 http://127.0.0.1:4000
 *   WB_FIXTURE   受管项目根（含 long.js），默认 tests/integration/fixtures/sample-job 的绝对路径
 */
import { resolve } from 'node:path';

const API = process.env.WB_API_URL ?? 'http://127.0.0.1:4000';
const FIXTURE = process.env.WB_FIXTURE ?? resolve('tests/integration/fixtures/sample-job');
const NODE = process.execPath;

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

const manifest = {
  schemaVersion: 'workbench.project/v1',
  project: { id: 'conc-demo', name: '并发约束演示项目' },
  runtime: { root: FIXTURE },
  commands: [
    {
      id: 'singleton-job',
      type: 'job',
      executable: NODE,
      arguments: ['long.js'],
      timeoutSeconds: 0,
      concurrency: 'singleton',
    },
    {
      id: 'parallel-job',
      type: 'job',
      executable: NODE,
      arguments: ['long.js'],
      timeoutSeconds: 0,
      concurrency: 'parallel',
    },
  ],
};

const run = (commandId) =>
  api(`/api/v1/projects/conc-demo/commands/${commandId}/runs`, { method: 'POST' });
const cancel = (runId) => api(`/api/v1/runs/${runId}/cancel`, { method: 'POST' });
const getRun = async (runId) => (await api(`/api/v1/runs/${runId}`)).body;

/** 轮询等待 Run 到达目标状态（进程终止是异步的，固定 sleep 不稳）。 */
async function waitForStatus(runId, expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await getRun(runId);
    if (expected.includes(last?.status)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

async function main() {
  const reg = await api('/api/v1/projects/register', {
    method: 'POST',
    body: JSON.stringify(manifest),
  });
  check(
    '注册含 singleton/parallel 命令的项目',
    reg.status === 200 || reg.body?.error?.code === 'PROJECT_ALREADY_EXISTS',
    `status=${reg.status}`,
  );

  // --- singleton：第二次被拒 ---
  const first = await run('singleton-job');
  check('singleton 首次启动 → RUNNING', first.body?.status === 'RUNNING', first.body?.status);

  const second = await run('singleton-job');
  check(
    'singleton 并发第二次 → FAILED / RUN_STATE_CONFLICT',
    second.body?.status === 'FAILED' && second.body?.errorCode === 'RUN_STATE_CONFLICT',
    `status=${second.body?.status} code=${second.body?.errorCode}`,
  );

  const events = await api(`/api/v1/runs/${second.body?.id}/events`);
  const conflict = (events.body?.items ?? []).find(
    (e) => e.eventType === 'state' && e.payload?.errorCode === 'RUN_STATE_CONFLICT',
  );
  check(
    '冲突 Run 事件流带 activeRunId（可追溯）',
    conflict?.payload?.activeRunId === first.body?.id,
    JSON.stringify(conflict?.payload ?? {}),
  );

  check('首个 Run 未被误伤（仍 RUNNING）', (await getRun(first.body?.id))?.status === 'RUNNING');

  await cancel(first.body.id);
  const cancelled = await waitForStatus(first.body.id, ['CANCELLED']);
  check('取消首个 Run → CANCELLED', cancelled?.status === 'CANCELLED', cancelled?.status);

  // --- singleton：终态后可再次启动（非永久锁） ---
  const third = await run('singleton-job');
  check('singleton 终态后再启动 → RUNNING', third.body?.status === 'RUNNING', third.body?.status);
  await cancel(third.body.id);
  await waitForStatus(third.body?.id, ['CANCELLED']);

  // --- parallel：允许并发 ---
  const p1 = await run('parallel-job');
  const p2 = await run('parallel-job');
  check(
    'parallel 允许两个并发 Run 同时 RUNNING',
    p1.body?.status === 'RUNNING' && p2.body?.status === 'RUNNING',
    `${p1.body?.status} / ${p2.body?.status}`,
  );
  await cancel(p1.body.id);
  await cancel(p2.body.id);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n== ${passed}/${results.length} checks passed ==`);
  if (passed !== results.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
