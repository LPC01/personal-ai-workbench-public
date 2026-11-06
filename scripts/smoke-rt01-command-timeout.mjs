/**
 * RT-01 真实冒烟驱动：验证 `ProjectCommand.timeoutSeconds` 真正生效（26 SPEC §5）。
 *
 * 前置：
 *   - server 已启动在 `WB_BASE`（默认 http://127.0.0.1:4000），使用**全新** WB_DATA_DIR
 *     （`register` 对同一 root 做唯一性校验，复用旧库会 409/冲突）。
 *   - `WB_FIXTURE` 指向含 `long.js` 的真实目录（tests/integration/fixtures/sample-job）。
 *
 * 用法：WB_FIXTURE=<abs-dir> node scripts/smoke-rt01-command-timeout.mjs
 */
const BASE = process.env.WB_BASE ?? 'http://127.0.0.1:4000';
const FIXTURE = process.env.WB_FIXTURE;
if (!FIXTURE) {
  console.error('缺少 WB_FIXTURE（真实项目目录绝对路径）');
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 响应保留原文 */
  }
  return { status: res.status, json, text };
}

async function waitTerminal(runId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await req('GET', `/api/v1/runs/${runId}`);
    const s = r.json?.status;
    if (s === 'SUCCEEDED' || s === 'FAILED' || s === 'CANCELLED') return r.json;
    await sleep(100);
  }
  throw new Error(`run ${runId} 未在期限内到达终态`);
}

// 1) 注册项目：命令 A 声明 2s 超时，命令 B 声明 0（不限制）
const manifest = {
  schemaVersion: 'workbench.project/v1',
  project: { id: 'rt01-smoke', name: 'RT-01 命令超时冒烟' },
  runtime: { root: FIXTURE },
  commands: [
    {
      id: 'slow-timeout',
      type: 'job',
      executable: 'node',
      arguments: ['long.js'],
      timeoutSeconds: 2,
    },
    {
      id: 'slow-unlimited',
      type: 'job',
      executable: 'node',
      arguments: ['long.js'],
      timeoutSeconds: 0,
    },
  ],
};
const reg = await req('POST', '/api/v1/projects/register', manifest);
check('注册含 commands[].timeoutSeconds 的项目', reg.status === 200, `status=${reg.status}`);
if (reg.status !== 200) {
  console.error(reg.text);
  process.exit(1);
}

// 2) 声明 2s 超时的长跑 job：应被真实超时终止
const t0 = Date.now();
const start1 = await req('POST', '/api/v1/projects/rt01-smoke/commands/slow-timeout/runs');
check(
  '启动 slow-timeout 并进入 RUNNING',
  start1.json?.status === 'RUNNING',
  `status=${start1.json?.status}`,
);
const final1 = await waitTerminal(start1.json.id);
const elapsed1 = Date.now() - t0;
check('超时后终态 = FAILED', final1.status === 'FAILED', `status=${final1.status}`);
check('错误码 = TIMEOUT', final1.errorCode === 'TIMEOUT', `errorCode=${final1.errorCode}`);
check(
  '超时在 ~2s 触发（1.5s–8s 宽容区间）',
  elapsed1 >= 1500 && elapsed1 <= 8000,
  `elapsed=${elapsed1}ms`,
);

const ev1 = await req('GET', `/api/v1/runs/${start1.json.id}/events`);
const hasTimeoutEvent = (ev1.json?.items ?? []).some(
  (e) =>
    e.eventType === 'state' && e.payload?.to === 'FAILED' && e.payload?.errorCode === 'TIMEOUT',
);
check('事件流含 state→FAILED（errorCode=TIMEOUT）', hasTimeoutEvent);

// 3) timeoutSeconds=0：不限制，静置后仍应 RUNNING（证明未被误超时）
const start2 = await req('POST', '/api/v1/projects/rt01-smoke/commands/slow-unlimited/runs');
await sleep(3500);
const mid = await req('GET', `/api/v1/runs/${start2.json.id}`);
check(
  'timeoutSeconds=0 静置 3.5s 仍 RUNNING',
  mid.json?.status === 'RUNNING',
  `status=${mid.json?.status}`,
);
const cancelled = await req('POST', `/api/v1/runs/${start2.json.id}/cancel`);
check(
  '手动取消进入 CANCELLING',
  cancelled.json?.status === 'CANCELLING',
  `status=${cancelled.json?.status}`,
);
const final2 = await waitTerminal(start2.json.id);
check('手动取消终态 = CANCELLED', final2.status === 'CANCELLED', `status=${final2.status}`);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
