/**
 * UI-09 验收冒烟：Harness Profile 管理面板（新建 / 修订 / 探测）。
 *
 * 覆盖：
 * 1. 空态 → 新建 mock Profile → 列表出现且发起表单下拉自动选中；
 * 2. 探测（mock adapter 恒 ok:true）→ 显示「可用」；
 * 3. 修订同 id → revision 递增到 2（后端 upsert 语义）；
 * 4. 反向断言：deepseek 类型删掉 baseUrl 时**前端就拦下**，不产生新增记录
 *    （后端 DeepSeekHarnessAdapter 缺 baseUrl 会在构造期抛 HARNESS_UNAVAILABLE，
 *    不能等到探测才炸）；
 * 5. 适配器下拉把未实现的 openai-agents 显式标注出来；
 * 6. 三视口 0px 水平溢出 + 截图。
 *
 * 用法：node scripts/smoke-harness-ui.mjs   （端口可用 SMOKE_PORT / SMOKE_WEB_PORT 覆盖）
 * 同进程内 spawn server + vite → 驱动真实浏览器 → 截三视口 → kill。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const ROOT = process.cwd();
const PORT = Number(process.env.SMOKE_PORT ?? 4183);
const WEB_PORT = Number(process.env.SMOKE_WEB_PORT ?? 5199);
const BASE = `http://127.0.0.1:${PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const DATA = resolve(ROOT, 'var', 'smoke-ui09-data');
const SHOTS = resolve(ROOT, 'var', 'verification');

const ID_MOCK = 'harness-ui09-mock';

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

async function countProfiles() {
  const r = await fetch(`${BASE}/api/v1/harness-profiles`);
  const j = await r.json();
  return j.total ?? j.items.length;
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
    check('起始无 Harness Profile', (await countProfiles()) === 0);

    browser = await chromium.launch({ channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await page.goto(`${WEB}/#/agent`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '新建', exact: true }).waitFor({
      state: 'visible',
      timeout: 15000,
    });
    // 列表是异步拉取的：等空态渲染出来再断言
    await page
      .getByText('暂无 Harness Profile')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => {});
    {
      const n = await page.getByText('暂无 Harness Profile').count();
      check('空态提示可见', n >= 1, `count=${n}`);
    }

    // ---- 1. 新建 mock Profile ----
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await page.getByLabel('Harness Profile id').fill(ID_MOCK);
    await page.getByLabel('Harness Profile 名称').fill('UI09 Mock 内核');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    // 用 .wb-alert 收窄：页面同时存在下拉选项等其它「已创建」字样（strict mode 会报错）
    await page
      .locator('.wb-alert', { hasText: '已创建' })
      .waitFor({ state: 'visible', timeout: 15000 });
    check(
      '创建成功并提示 revision',
      (await countProfiles()) === 1,
      `total=${await countProfiles()}`,
    );

    // 发起表单的下拉应自动选中新建项
    const selected = await page.getByLabel('Harness Profile').inputValue();
    check('发起表单下拉自动选中新建项', selected === ID_MOCK, selected);

    // ---- 2. 探测 ----
    await page.getByRole('button', { name: '探测', exact: true }).first().click();
    await page
      .locator('.wb-alert', { hasText: '探测' })
      .waitFor({ state: 'visible', timeout: 15000 });
    await sleep(600);
    const probeText = await page.locator('.wb-alert').allInnerTexts();
    check(
      'mock 探测返回可用',
      probeText.join(' ').includes('可用'),
      probeText.join(' | ').replace(/\n+/g, ' ').slice(0, 120),
    );

    // ---- 3. 修订 → revision +1 ----
    await page.getByRole('button', { name: '修订', exact: true }).first().click();
    await page.getByLabel('Harness Profile 名称').fill('UI09 Mock 内核（已修订）');
    await page.getByRole('button', { name: '提交修订', exact: true }).click();
    await page
      .locator('.wb-alert', { hasText: '已修订' })
      .waitFor({ state: 'visible', timeout: 15000 });
    const afterEdit = await fetch(`${BASE}/api/v1/harness-profiles`).then((r) => r.json());
    check(
      '修订同 id 使 revision 增至 2（后端 upsert）',
      afterEdit.items[0].revision === 2 && afterEdit.total === 1,
      `revision=${afterEdit.items[0].revision} total=${afterEdit.total}`,
    );

    // ---- 4. 反向断言：deepseek 缺 baseUrl 被前端拦下 ----
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await page.getByLabel('Harness Profile id').fill('harness-ui09-deepseek');
    await page.getByLabel('Harness Profile 名称').fill('缺 baseUrl');
    await page.getByLabel('适配器类型').selectOption('deepseek');
    await page.getByLabel('config').fill('{}');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await sleep(800);
    const blocked = await page.locator('.wb-alert').allInnerTexts();
    check(
      'deepseek 缺 baseUrl 在前端被拦下',
      blocked.join(' ').includes('baseUrl'),
      blocked.join(' | ').replace(/\n+/g, ' ').slice(0, 120),
    );
    check('拦截后未产生新记录', (await countProfiles()) === 1, `total=${await countProfiles()}`);

    // ---- 5. 未实现的适配器被标注 ----
    const optionTexts = await page.getByLabel('适配器类型').locator('option').allInnerTexts();
    check(
      'openai-agents 标注为适配器未实现',
      optionTexts.some((t) => t.includes('OpenAI Agents') && t.includes('未实现')),
      optionTexts.join(' / '),
    );

    await page.getByRole('button', { name: '取消', exact: true }).first().click();
    check('全程无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

    // ---- 6. 三视口 0px 溢出 + 截图 ----
    for (const vp of [
      { width: 1440, height: 1000, name: '1440x1000' },
      { width: 768, height: 1000, name: '768x1000' },
      { width: 390, height: 844, name: '390x844' },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${WEB}/#/agent`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        for (const d of document.querySelectorAll('details.wb-side__narrow')) d.open = true;
      });
      await page.getByText('Harness Profile', { exact: false }).first().waitFor({
        state: 'visible',
        timeout: 15000,
      });
      await sleep(400);
      const of = await page.evaluate(() => {
        const d = document.documentElement;
        return Math.max(0, d.scrollWidth - d.clientWidth);
      });
      check(`视口 ${vp.name} 无水平溢出`, of === 0, `${of}px`);
      await page.screenshot({
        path: resolve(SHOTS, `UI-09-screenshot-harness-${vp.name}.png`),
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
