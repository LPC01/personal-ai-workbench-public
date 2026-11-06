/**
 * UI-08 验收冒烟：侧栏「运行」页签已隐藏，且能力未删。
 *
 * 覆盖：
 * 1. 侧栏导航恰 9 项、不含「运行」；
 * 2. hash 直达 `#/runs` 回落到「项目」（不是空白页，也不是残留的运行台帐）；
 * 3. 其余 9 个页签逐个可点且激活态正确，无控制台错误；
 * 4. 反向断言：后端 `GET /api/v1/runs` 仍可用（本次只动可达性，未删能力）；
 * 5. 三视口 0px 水平溢出 + 截图。
 *
 * 用法：node scripts/smoke-nav-hide-runs.mjs   （端口可用 SMOKE_PORT / SMOKE_WEB_PORT 覆盖）
 * 同进程内 spawn server + vite → 驱动真实浏览器 → 截三视口 → kill。
 *
 * ⚠️ server 跑的是 `apps/server/dist/index.js`（编译产物），前端改动需 vite 实时编译即可。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const ROOT = process.cwd();
const PORT = Number(process.env.SMOKE_PORT ?? 4181);
const WEB_PORT = Number(process.env.SMOKE_WEB_PORT ?? 5198);
const BASE = `http://127.0.0.1:${PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const DATA = resolve(ROOT, 'var', 'smoke-ui08-data');
const SHOTS = resolve(ROOT, 'var', 'verification');

/** 期望保留的导航项（顺序即 UI 顺序）。 */
const EXPECTED_NAV = [
  '项目',
  'Agent 执行',
  '模型',
  '工坊',
  'Issue',
  '用量',
  '诊断',
  '聊天室',
  '记忆中心',
];

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

/** 文档横向溢出：scrollWidth 超出 clientWidth 即为溢出（30 号 §5 要求 0px）。 */
async function overflow(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return Math.max(0, d.scrollWidth - d.clientWidth);
  });
}

async function main() {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });

  const server = spawn(process.execPath, [resolve(ROOT, 'apps', 'server', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), WB_DATA_DIR: DATA },
    stdio: 'ignore',
  });
  const vite = spawn(
    process.execPath,
    [
      resolve(ROOT, 'apps', 'web', 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port',
      String(WEB_PORT),
      '--strictPort',
    ],
    {
      cwd: resolve(ROOT, 'apps', 'web'),
      env: { ...process.env, WB_API_PORT: String(PORT) },
      stdio: 'ignore',
    },
  );

  let browser;
  try {
    await waitFor('server', `${BASE}/api/v1/projects`);
    await waitFor('vite', WEB);

    // ---- 反向断言：后端 Run 能力未删 ----
    const runsRes = await fetch(`${BASE}/api/v1/runs`);
    const runsJson = await runsRes.json();
    check(
      '后端 GET /api/v1/runs 仍可用（能力保留）',
      runsRes.ok && Array.isArray(runsJson.items),
      `${runsRes.status} total=${runsJson.total}`,
    );

    browser = await chromium.launch({ channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await page.goto(`${WEB}/#/projects`, { waitUntil: 'domcontentloaded' });
    await page.locator('.wb-nav__item').first().waitFor({ state: 'visible', timeout: 15000 });

    // ---- 1. 导航项不含「运行」 ----
    const navTexts = (await page.locator('.wb-nav__item').allInnerTexts()).map((t) => t.trim());
    check(
      '侧栏导航恰 9 项且为预期集合',
      navTexts.length === EXPECTED_NAV.length &&
        EXPECTED_NAV.every((label, i) => navTexts[i] === label),
      navTexts.join(' / '),
    );
    check('侧栏不含「运行」页签', !navTexts.some((t) => t.includes('运行')), navTexts.join(' / '));

    // ---- 2. hash 直达 #/runs 回落到「项目」 ----
    await page.goto(`${WEB}/#/runs`, { waitUntil: 'domcontentloaded' });
    await page.locator('.wb-nav__item--active').waitFor({ state: 'visible', timeout: 15000 });
    const active = (await page.locator('.wb-nav__item--active').innerText()).trim();
    check('hash 直达 #/runs 回落到「项目」', active === '项目', `当前激活：${active}`);
    const bodyText = await page.locator('main').innerText();
    check(
      '回落页不是空白（项目页正常渲染）',
      bodyText.includes('项目'),
      bodyText.slice(0, 80).replace(/\n+/g, ' ⏎ '),
    );
    check('回落页不残留 Run 台账', !bodyText.includes('未选择运行'), bodyText.slice(0, 80));

    // ---- 3. 其余 9 个页签逐个可点 ----
    for (const label of EXPECTED_NAV) {
      await page.locator('.wb-nav__item', { hasText: label }).first().click();
      await sleep(200);
      const cur = (await page.locator('.wb-nav__item--active').innerText()).trim();
      const mainText = await page.locator('main').innerText();
      check(`页签「${label}」可点且激活`, cur === label, `激活=${cur}`);
      check(`页签「${label}」主区非空`, mainText.trim().length > 0, `${mainText.length} 字符`);
    }

    check('全程无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

    // ---- 4. 三视口 0px 水平溢出 + 截图 ----
    const viewports = [
      { width: 1440, height: 1000, name: '1440x1000' },
      { width: 768, height: 1000, name: '768x1000' },
      { width: 390, height: 844, name: '390x844' },
    ];
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${WEB}/#/projects`, { waitUntil: 'domcontentloaded' });
      // ≤900px 时侧栏折叠进 <details>（30 号 §5）：展开后才能看到导航项。
      // 用 JS 置 open 而非点击 summary——点击是 toggle，跨视口连续跑时会把已展开的又收起。
      await page.evaluate(() => {
        for (const d of document.querySelectorAll('details.wb-side__narrow')) d.open = true;
      });
      await page.locator('.wb-nav__item').first().waitFor({ state: 'visible', timeout: 15000 });
      await sleep(400);
      const of = await overflow(page);
      check(`视口 ${vp.name} 无水平溢出`, of === 0, `${of}px`);
      await page.screenshot({
        path: resolve(SHOTS, `UI-08-screenshot-nav-${vp.name}.png`),
        fullPage: false,
      });
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGKILL');
    vite.kill('SIGKILL');
    await sleep(300);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    console.log('失败项：');
    for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('冒烟异常：', e);
  process.exitCode = 1;
});
