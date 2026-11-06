/**
 * CRED-05 验收冒烟：模型页「直接录入外部 API Key」闭环。
 *
 * 覆盖：表单录入明文 → 经 /api/v1/credentials 登记 → 只回写引用 → 界面只回显掩码。
 * 反向断言（更重要）：明文不得出现在 SQLite、不得残留在输入框、凭据文件不得含明文。
 *
 * 用法：node scripts/smoke-credential-ui.mjs   （端口可用 SMOKE_PORT / SMOKE_WEB_PORT 覆盖）
 * 同进程内 spawn server + vite → 驱动真实浏览器 → 截三视口 → kill。
 *
 * ⚠️ server 跑的是 `apps/server/dist/index.js`（编译产物）。本脚本不改后端，
 * 若后端/包有未构建的改动，请先 `pnpm -r build`，否则会拿着旧 dist 跑出假失败。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const ROOT = process.cwd();
const PORT = Number(process.env.SMOKE_PORT ?? 4131);
const WEB_PORT = Number(process.env.SMOKE_WEB_PORT ?? 5199);
const BASE = `http://127.0.0.1:${PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const DATA = resolve(ROOT, 'var', 'smoke-credential-ui-data');
const SHOTS = resolve(ROOT, 'var', 'verification');

const PROVIDER_ID = 'cred-smoke-openai';
const SECRET = 'sk-smoke-abcdef123456';
const MASK_TAIL = SECRET.slice(-4);

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
    await waitFor('server', `${BASE}/api/v1/model-providers`);
    await waitFor('vite', WEB);

    browser = await chromium.launch({ channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await page.goto(`${WEB}/#/models`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '新增 Provider' }).click();

    const card = page.locator('[aria-label="Provider 凭据冒烟"]');
    await page.getByLabel('Provider ID').fill(PROVIDER_ID);
    await page.getByLabel('Provider 名称').fill('凭据冒烟');
    await page.getByLabel('Provider baseUrl').fill('https://api.openai.com/v1');
    await page.getByLabel('Provider API Key').fill(SECRET);
    await page.getByRole('button', { name: '保存新 Provider' }).click();
    await card.waitFor({ state: 'visible', timeout: 15000 });

    // ① 列表徽章：已绑定凭据
    const badge = await card.getByText('已绑凭据').count();
    check('列表徽章显示「已绑凭据」', badge > 0);

    // ② 打开编辑态：状态行给出 ref + 掩码，且明文框已被清空
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByText('已绑定').first().waitFor({ state: 'visible', timeout: 15000 });
    const masked = await page
      .locator('.wb-chip', { hasText: /^\*\*\*\*/ })
      .first()
      .innerText();
    check('回显服务端掩码（末 4 位一致）', masked.endsWith(MASK_TAIL), masked);
    const leftover = await page.getByLabel('Provider API Key').inputValue();
    check('明文输入框已清空', leftover === '', JSON.stringify(leftover));

    // ③ 三视口截图 + 水平溢出
    for (const [w, h] of [
      [1440, 1000],
      [768, 1000],
      [390, 844],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await sleep(200);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      check(`${w}px 无水平溢出`, overflow <= 0, `${overflow}px`);
      await page.screenshot({
        path: join(SHOTS, `CRED-05-screenshot-credential-${w}x${h}.png`),
        fullPage: true,
      });
    }

    // ④ API 侧：Provider 只持有引用
    const res = await fetch(`${BASE}/api/v1/model-providers`);
    const { items } = await res.json();
    const saved = items.find((p) => p.id === PROVIDER_ID);
    check(
      'Provider 绑定了 credentialRef',
      Boolean(saved?.credentialRef),
      saved?.credentialRef ?? '',
    );

    // ⑤ 反向断言：明文不落 SQLite、不落凭据文件
    const db = readFileSync(join(DATA, 'workbench.db'));
    check('SQLite 中不含明文密钥', !db.includes(SECRET));
    const credFile = readFileSync(join(DATA, 'credentials', `${saved.credentialRef}.json`), 'utf8');
    check(
      '凭据文件为密文（不含明文）',
      !credFile.includes(SECRET) && credFile.includes('encrypted'),
    );

    check('浏览器控制台无错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
  } finally {
    if (browser) await browser.close();
    server.kill();
    vite.kill();
    rmSync(DATA, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
