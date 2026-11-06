/**
 * PROJ-UI-01 验收冒烟：项目页卡片网格 + 详情页 README 简介。
 *
 * 覆盖：列表卡片网格 → 统计条 → 点卡片进详情（深链） → 简介页签渲染 README → 返回列表。
 * 反向断言（更重要）：不可信 README 里的 `<script>` 与 `javascript:` 链接
 * 不得变成可执行元素；未填 description 的项目不得显示空简介块。
 *
 * 用法：node scripts/smoke-project-ui.mjs   （端口可用 SMOKE_PORT / SMOKE_WEB_PORT 覆盖）
 * 同进程内 spawn server + vite → 驱动真实浏览器 → 截三视口 → kill。
 *
 * ⚠️ server 跑的是 `apps/server/dist/index.js`（编译产物）。改了 packages/** 或
 * apps/server/** 后必须先 `pnpm -r build`（至少 `pnpm --filter @workbench/project-runtime build`），
 * 否则会拿着旧 dist 跑出「新增端点 500」的假失败。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const ROOT = process.cwd();
const PORT = Number(process.env.SMOKE_PORT ?? 4171);
const WEB_PORT = Number(process.env.SMOKE_WEB_PORT ?? 5197);
const BASE = `http://127.0.0.1:${PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const DATA = resolve(ROOT, 'var', 'smoke-project-ui-data');
const SHOTS = resolve(ROOT, 'var', 'verification');

const ID_README = 'proj-ui-readme';
const ID_HOSTILE = 'proj-ui-hostile';

const NORMAL_README = [
  '# 冒烟项目自述',
  '',
  '这是用于验收的正文段落。',
  '',
  '## 特性',
  '',
  '- 列表项 A',
  '- 列表项 B',
  '',
  '| 列1 | 列2 |',
  '| --- | --- |',
  '| a | b |',
  '',
  '行内代码 `npm test` 与一段块级代码：',
  '',
  '```js',
  "console.log('hello');",
  '```',
  '',
  '[安全外链](https://example.com)',
].join('\n');

// 不可信输入：README 来自「任意登记的项目目录」，渲染必须不可执行
const HOSTILE_README = [
  '# 恶意自述',
  '',
  '<script>window.__xss = 1;</script>',
  '',
  '[点我](javascript:window.__xss=2)',
  '',
  '![图片](javascript:window.__xss=3)',
  '',
  '<img src=x onerror="window.__xss=4">',
].join('\n');

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

async function register(manifest) {
  const r = await fetch(`${BASE}/api/v1/projects/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  if (!r.ok) throw new Error(`登记失败 ${r.status}：${(await r.text()).slice(0, 300)}`);
}

function manifest(id, name, root, description) {
  return {
    schemaVersion: 'workbench.project/v1',
    project: { id, name, ...(description ? { description } : {}) },
    runtime: { root },
    commands: [{ id: 'noop', type: 'service', executable: 'node', arguments: ['-e', ''] }],
  };
}

async function main() {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });

  const dirReadme = mkdtempSync(join(tmpdir(), 'wb-proj-readme-'));
  const dirHostile = mkdtempSync(join(tmpdir(), 'wb-proj-hostile-'));
  writeFileSync(join(dirReadme, 'README.md'), NORMAL_README, 'utf8');
  writeFileSync(join(dirHostile, 'README.md'), HOSTILE_README, 'utf8');

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
    await waitFor('server', `${BASE}/api/v1/projects`);
    await waitFor('vite', WEB);

    await register(manifest(ID_README, '冒烟·带自述', dirReadme, '这是一个用于验收的项目简介'));
    await register(manifest(ID_HOSTILE, '冒烟·恶意自述', dirHostile));

    // 先确认后端端点本身是通的（前端失败时好区分是前端还是后端）
    const probeRes = await fetch(`${BASE}/api/v1/projects/${ID_README}/readme?probe=1`);
    const probeJson = await probeRes.json();
    check('API 探测到自述文件', probeJson.found === true, JSON.stringify(probeJson));

    browser = await chromium.launch({ channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    // ---- 列表页：卡片网格 + 统计条 ----
    await page.goto(`${WEB}/#/projects`, { waitUntil: 'domcontentloaded' });
    const cards = page.locator('.wb-pcard');
    await cards.first().waitFor({ state: 'visible', timeout: 15000 });
    check('列表渲染为卡片网格', (await cards.count()) === 2, `${await cards.count()} 张卡片`);

    // 探测是异步并发的：等「有 README」落到 2 再断言，避免读到首帧的 0
    await page
      .waitForFunction(
        () => {
          const nodes = Array.from(document.querySelectorAll('.wb-stat'));
          const target = nodes.find((n) => (n.textContent ?? '').includes('有 README'));
          return (target?.textContent ?? '').includes('2');
        },
        undefined,
        { timeout: 15000 },
      )
      .catch(() => {});
    const stats = await page.locator('.wb-stat').allInnerTexts();
    check(
      '统计条三项真实数据',
      stats.length === 3 && stats[0].includes('已登记') && stats.join('|').includes('有 README'),
      stats.join(' / ').replace(/\n/g, ' '),
    );

    // 只在卡片徽章里计数：统计条的标签也含「README」字样，直接 getByText 会多算
    const readmeBadges = await page.locator('.wb-pcard .wb-badge', { hasText: 'README' }).count();
    check('有自述文件的卡片带 README 徽章', readmeBadges === 2, `${readmeBadges}`);

    // ---- 点卡片 → 详情页（深链） ----
    await page.locator('.wb-pcard', { hasText: '冒烟·带自述' }).click();
    await page.locator('.wb-banner__title').waitFor({ state: 'visible', timeout: 15000 });
    check('点击进入详情页并写入深链', page.url().includes(`#/projects/p/${ID_README}`), page.url());
    check(
      '横幅标题为项目名',
      (await page.locator('.wb-banner__title').innerText()) === '冒烟·带自述',
    );

    // ---- 简介页签：README 渲染 ----
    const md = page.locator('.wb-md');
    await md.waitFor({ state: 'visible', timeout: 15000 });
    check('简介渲染 README 标题', (await md.locator('h1').innerText()) === '冒烟项目自述');
    check('GFM 表格被渲染', (await md.locator('table').count()) === 1);
    check('代码块被渲染', (await md.locator('pre code').count()) === 1);
    check('列表被渲染', (await md.locator('ul li').count()) === 2);
    const safeLink = await md.locator('a[href="https://example.com"]').count();
    check('安全外链保留为可点链接', safeLink === 1);

    // 深链刷新后仍停在详情页
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.wb-banner__title').waitFor({ state: 'visible', timeout: 15000 });
    check(
      '刷新后深链不丢',
      (await page.locator('.wb-banner__title').innerText()) === '冒烟·带自述',
    );

    // ---- 反向断言：恶意 README 不可执行 ----
    await page.goto(`${WEB}/#/projects/p/${ID_HOSTILE}`, { waitUntil: 'domcontentloaded' });
    // 深链导航后要重新拉起应用并加载 README，等渲染完成再断言
    await page.locator('.wb-banner__title').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('.wb-md').waitFor({ state: 'visible', timeout: 20000 });
    const xss = await page.evaluate(() => window.__xss);
    check('恶意 README 未执行脚本', xss === undefined, String(xss));
    check('markdown 区域无 script 元素', (await page.locator('.wb-md script').count()) === 0);
    check('markdown 区域无 img 注入', (await page.locator('.wb-md img').count()) === 0);
    const blocked = await page.locator('.wb-md__blocked').count();
    check('危险链接降级为不可点文本', blocked >= 2, `${blocked} 处`);

    // ---- 返回列表 ----
    await page.getByRole('button', { name: '返回项目列表' }).click();
    await page.locator('.wb-pcard').first().waitFor({ state: 'visible', timeout: 15000 });
    check('返回按钮回到卡片网格', (await page.locator('.wb-pcard').count()) === 2);

    // ---- 三视口截图 + 水平溢出（列表页与详情页各一轮） ----
    for (const [w, h] of [
      [1440, 1000],
      [768, 1000],
      [390, 844],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await sleep(250);
      let overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      check(`列表页 ${w}px 无水平溢出`, overflow <= 0, `${overflow}px`);
      await page.screenshot({
        path: join(SHOTS, `PROJ-UI-01-screenshot-grid-${w}x${h}.png`),
        fullPage: true,
      });

      await page.goto(`${WEB}/#/projects/p/${ID_README}`, { waitUntil: 'domcontentloaded' });
      await page.locator('.wb-md').waitFor({ state: 'visible', timeout: 15000 });
      overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      check(`详情页 ${w}px 无水平溢出`, overflow <= 0, `${overflow}px`);
      await page.screenshot({
        path: join(SHOTS, `PROJ-UI-01-screenshot-detail-${w}x${h}.png`),
        fullPage: true,
      });
    }

    check('浏览器控制台无错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
  } finally {
    if (browser) await browser.close();
    server.kill();
    vite.kill();
    rmSync(DATA, { recursive: true, force: true });
    rmSync(dirReadme, { recursive: true, force: true });
    rmSync(dirHostile, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
