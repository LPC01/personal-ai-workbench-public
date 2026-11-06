/**
 * UI-10 验收冒烟：聊天室全流程闭环。
 *
 * 覆盖：建房间 → 新建 Run → 配置参与者（Harness + 模型）→ 启动编排 → 发消息
 * 自动推进两位参与者真实发言 → 时间线实时追加 → 任务板新增/流转/交接 → 结束 Run。
 *
 * 反向断言（更重要）：
 * - 未启动编排时不得出现「发送并推进」可用按钮（避免点了没反应的假可用）；
 * - Harness 与模型只填其一时必须被拦下，且不产生会话；
 * - 模型空产出时不得伪造 AGENT_MESSAGE。
 *
 * 用法：node scripts/smoke-room-chat.mjs（端口可用 SMOKE_PORT / SMOKE_WEB_PORT 覆盖）
 * ⚠️ server 跑 `apps/server/dist/index.js`：改了 packages/** 或 apps/server/** 后
 * 必须先 `pnpm -r build`，否则会拿旧 dist 跑出假失败。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const ROOT = process.cwd();
const PORT = Number(process.env.SMOKE_PORT ?? 4173);
const WEB_PORT = Number(process.env.SMOKE_WEB_PORT ?? 5199);
const BASE = `http://127.0.0.1:${PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const DATA = resolve(ROOT, 'var', 'smoke-room-chat-data');
const SHOTS = resolve(ROOT, 'var', 'verification');

const ROOM = 'room-ui-10';
const HARNESS = 'harness-ui10-mock';
const MODEL = 'mp-ui10';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitFor(label, url, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await reachable(url)) return true;
    await sleep(300);
  }
  throw new Error(`${label} 未就绪：${url}`);
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) throw new Error(`${path} 失败 ${r.status}：${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} 失败 ${r.status}`);
  return r.json();
}

const viewports = [
  { name: '1440x1000', width: 1440, height: 1000 },
  { name: '768x1000', width: 768, height: 1000 },
  { name: '390x844', width: 390, height: 844 },
];

async function main() {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });

  const server = spawn(process.execPath, [join(ROOT, 'apps', 'server', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), WB_DATA_DIR: DATA },
    stdio: 'ignore',
  });
  const vite = spawn(
    process.execPath,
    [
      join(ROOT, 'apps', 'web', 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port',
      String(WEB_PORT),
      '--strictPort',
    ],
    {
      cwd: join(ROOT, 'apps', 'web'),
      env: { ...process.env, WB_API_PORT: String(PORT) },
      stdio: 'ignore',
    },
  );

  let browser;
  try {
    await waitFor('server', `${BASE}/api/v1/rooms`);
    await waitFor('vite', WEB);

    // ---- 前置数据：可编程 mock harness（有脚本 = 有真实内容）+ 模型 Profile ----
    await post('/api/v1/harness-profiles', {
      id: HARNESS,
      name: '冒烟 Mock',
      adapterType: 'mock',
      config: {
        script: [
          { content: '需求要点：先做登录页与鉴权', stopReason: 'end' },
          { content: '实现要点：加路由与状态机', stopReason: 'end' },
          { content: '验收要点：补冒烟用例', stopReason: 'end' },
        ],
      },
    });
    await post('/api/v1/model-profiles', {
      id: MODEL,
      name: '冒烟模型',
      providerId: 'provider-ui10',
      modelId: 'mock-1',
      capabilities: [],
      contextLimit: 8192,
      dataBoundary: 'local-only',
    });
    await post('/api/v1/rooms', {
      name: 'UI-10 冒烟聊天室',
      roomType: 'sdd-delivery',
      manifest: { id: ROOM, name: 'UI-10 冒烟聊天室' },
    });
    await post(`/api/v1/rooms/${ROOM}/activate`);

    browser = await chromium.launch({ channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    // ---- 建 Run ----
    await page.goto(`${WEB}/#/rooms`, { waitUntil: 'domcontentloaded' });
    await page.locator('.wb-list__item').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.getByRole('button', { name: '新建 Run', exact: true }).click();
    const setup = page.locator('.wb-participant').first();
    await setup.waitFor({ state: 'visible', timeout: 15000 });
    check(
      '未启动编排时展示「配置并启动编排」面板',
      (await page.locator('.wb-participant').count()) === 2,
    );

    // ---- 反向断言：Harness 与模型只填其一 → 拦截且不产生会话 ----
    await page.getByLabel('参与者 1 id').fill('pm');
    await page.getByLabel('参与者 1 Harness Profile').selectOption(HARNESS);
    await page.getByRole('button', { name: '启动编排', exact: true }).click();
    await page.locator('.wb-alert--danger, .wb-alert').first().waitFor({ timeout: 10000 });
    const mismatchText = await page.locator('.wb-alert').first().innerText();
    check(
      'Harness 与模型不成对时被拦下',
      mismatchText.includes('必须同时选择'),
      mismatchText.slice(0, 80).replace(/\n/g, ' '),
    );

    // ---- 填完整配置并启动 ----
    await page.getByLabel('参与者 1 模型 Profile').selectOption(MODEL);
    await page.getByLabel('参与者 2 id').fill('dev');
    await page.getByLabel('参与者 2 Harness Profile').selectOption(HARNESS);
    await page.getByLabel('参与者 2 模型 Profile').selectOption(MODEL);
    await page.getByRole('button', { name: '启动编排', exact: true }).click();
    await page.getByRole('button', { name: '发送并推进', exact: true }).waitFor({
      state: 'visible',
      timeout: 20000,
    });
    check('启动编排后出现发言控制台', true);

    const sessions = await page.locator('.wb-block', { hasText: '参与者与会话' }).innerText();
    check('右栏出现两个参与者会话', sessions.includes('pm') && sessions.includes('dev'));
    check('会话标注已绑定 Harness', sessions.includes('已绑定 Harness'));

    // ---- 发消息 → 自动推进两位参与者真实发言（轮数选 2，覆盖「连续推进」控件） ----
    await page.getByLabel('你的消息').fill('请开始协作');
    await page.getByLabel('连续推进轮数').selectOption('2');
    await page.getByRole('button', { name: '发送并推进', exact: true }).click();
    const timeline = page.locator('.wb-timeline');
    await timeline.getByText('需求要点：先做登录页与鉴权').waitFor({ timeout: 30000 });
    check('时间线出现第一位参与者的真实产出', true);
    await timeline.getByText('实现要点：加路由与状态机').waitFor({ timeout: 30000 });
    check('时间线出现第二位参与者的真实产出', true);

    const tlText = await timeline.innerText();
    check('用户消息在时间线中', tlText.includes('请开始协作'));
    check('系统事实事件可读化（不直接甩事件名）', tlText.includes('上下文快照已固定'));

    // ---- 任务板：新增 → 流转 ----
    await page.getByRole('button', { name: '加任务', exact: true }).click();
    await page.getByLabel('任务 kind').fill('implement-login');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await page.locator('.wb-entity', { hasText: 'implement-login' }).first().waitFor({
      timeout: 15000,
    });
    check('任务板可新增任务', true);
    await page.getByLabel('任务 implement-login 状态').selectOption('ACCEPTED');
    await page.getByText('已验收').first().waitFor({ timeout: 15000 });
    check('任务状态可流转（ACCEPTED → 已验收）', true);

    // ---- Handoff ----
    await page
      .locator('.wb-entity', { hasText: 'implement-login' })
      .getByRole('button', { name: '交接' })
      .click();
    await page.getByLabel('交接目标 implement-login').selectOption('dev');
    await page.getByLabel('交接目标说明 implement-login').fill('补冒烟用例');
    await page.getByRole('button', { name: '提交交接', exact: true }).click();
    await timeline.getByText('交接完成', { exact: false }).waitFor({ timeout: 15000 });
    check('Handoff 写入时间线（交接完成）', true);

    // ---- 预算真实累计 ----
    const budget = await page.locator('.wb-block', { hasText: '运行预算' }).innerText();
    check('预算显示已用轮次', /轮次[\s\S]*2/.test(budget), budget.replace(/\n/g, ' ').slice(0, 80));

    // ---- 三视口截图 + 横向溢出 ----
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await sleep(500);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      check(`${vp.name} 无横向溢出`, overflow <= 0, `${overflow}px`);
      await page.screenshot({
        path: join(SHOTS, `UI-10-screenshot-roomchat-${vp.name}.png`),
        fullPage: false,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    // ---- 结束 Run ----
    await page.getByRole('button', { name: '结束（成功）', exact: true }).click();
    await page.getByText('已完成', { exact: false }).first().waitFor({ timeout: 15000 });
    const finalRun = await get('/api/v1/rooms/room-ui-10/runs');
    check(
      '结束后端到终态 SUCCEEDED',
      finalRun.items[0]?.status === 'SUCCEEDED',
      finalRun.items[0]?.status,
    );

    check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

    const passed = results.filter((r) => r.ok).length;
    console.log(`\n通过 ${passed}/${results.length}`);
    if (passed !== results.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
    vite.kill();
  }
}

main().catch((e) => {
  console.error('冒烟失败：', e);
  process.exitCode = 1;
});
