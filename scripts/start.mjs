#!/usr/bin/env node
/*
 * 一键启动（开发/日常使用）：构建后端 → 起后端 → 起前端 → 等待就绪 → 打开浏览器。
 *
 * 用法：
 *   pnpm start                 # 默认：构建 + 起后端 + 起前端 + 打开浏览器
 *   WB_SKIP_BUILD=1 pnpm start # 跳过构建（直用上次产物，启动更快）
 *   WB_NO_OPEN=1 pnpm start    # 不自动打开浏览器
 *   WB_PORT=4100 pnpm start    # 指定后端端口（前端代理自动跟随）
 *   WB_AUTO_PORT=1 pnpm start  # 端口被占用时自动改用空闲端口
 *
 * 环境变量：
 *   WB_PORT        后端端口（默认 4000；本机 3000 常被 Hyper-V/Docker 保留）
 *   WB_WEB_PORT    前端端口（默认 5173）
 *   WB_DATA_DIR    数据目录（默认 var，与程序目录分离）
 *   WB_NODE_HOME   已有的 Node 22 目录；版本不匹配时用于定位/（双击入口会优先选它）
 *   WB_AUTO_PORT   =1 端口被占用时自动向上找空闲端口（默认关闭：占用即报错退出）
 *   WB_AUTO_PORT_SCAN 自动分配时最多向后探测的端口数（默认 50）
 *   WB_SKIP_BUILD  =1 跳过 pnpm 构建
 *   WB_NO_OPEN     =1 不打开浏览器
 *
 * 无外部依赖（仅 Node 内置模块）。Ctrl+C 会同时结束后端与前端。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let PORT = Number(process.env.WB_PORT ?? 4000);
let WEB_PORT = Number(process.env.WB_WEB_PORT ?? 5173);
const DATA_DIR = process.env.WB_DATA_DIR ?? 'var';
const AUTO_PORT = process.env.WB_AUTO_PORT === '1';
const AUTO_PORT_SCAN = Number(process.env.WB_AUTO_PORT_SCAN ?? 50);
const SKIP_BUILD = process.env.WB_SKIP_BUILD === '1';
const NO_OPEN = process.env.WB_NO_OPEN === '1';

const SERVER_ENTRY = join(ROOT, 'apps', 'server', 'dist', 'index.js');
const VITE_BIN = join(ROOT, 'apps', 'web', 'node_modules', 'vite', 'bin', 'vite.js');
const IS_WIN = process.platform === 'win32';

// ── Node 版本闸门 ────────────────────────────────────────────────────────────
// `better-sqlite3` 是原生模块：它的 .node 二进制按 Node 的 ABI（NODE_MODULE_VERSION）
// 编译绑定，不能跨 Node 大版本复用。本仓库按 Node 22 安装（ABI 127）；用 Node 24
// （ABI 137）等其它版本加载，会在「打开数据库」时才抛 ERR_DLOPEN_FAILED（注意：
// require('better-sqlite3') 本身不报错，绑定是首次 new Database 时才加载）。
// 因此必须在构建与起进程之前拦住。此处取值须与 package.json engines / .nvmrc 一致，
// 由 tests/contract/node-version-pin.test.ts 守护。
const REQUIRED_NODE_MAJOR = 22;
const REQUIRED_NODE_ABI = '127';

// ── Node 22 探测 ─────────────────────────────────────────────────────────────
// 用途：版本不匹配时，在报错里直接给出「本机已有的 Node 22 在哪」，让用户能复制
// 一行命令就跑起来，而不是自己去找路径。start.cmd 用同一套位置做自动前置 PATH；
// 两处列表必须保持一致，由 tests/contract/node-version-pin.test.ts 守护。
// 注意：本文件始终保持「仅 Node 内置模块」零依赖。
const HOME_DIR = process.env.USERPROFILE ?? process.env.HOME ?? '';
const APPDATA_DIR = process.env.APPDATA ?? join(HOME_DIR, 'AppData', 'Roaming');
const LOCALAPPDATA_DIR = process.env.LOCALAPPDATA ?? join(HOME_DIR, 'AppData', 'Local');
const PROGRAM_FILES = process.env.ProgramFiles ?? 'C:\\Program Files';

/** 列出 base 下以 prefix 开头的子目录（可再拼一段 extra）；目录不存在时返回空数组。 */
function listVersionDirs(base, prefix, extra) {
  if (!base) return [];
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => join(base, entry.name, ...(extra ? [extra] : [])))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** 按优先级列出候选的 Node 22 目录（WB_NODE_HOME 最高）。 */
function node22Candidates() {
  const out = [];
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };
  push(process.env.WB_NODE_HOME);
  push(process.env.NVM_SYMLINK);
  for (const d of listVersionDirs(process.env.NVM_HOME, 'v22')) push(d);
  for (const d of listVersionDirs(join(APPDATA_DIR, 'nvm'), 'v22')) push(d);
  for (const d of listVersionDirs(join(HOME_DIR, '.fnm', 'node-versions'), 'v22', 'installation')) {
    push(d);
  }
  for (const d of listVersionDirs(join(HOME_DIR, '.asdf', 'installs', 'nodejs'), '22')) push(d);
  for (const d of listVersionDirs(
    join(LOCALAPPDATA_DIR, 'Volta', 'tools', 'image', 'node'),
    '22',
  )) {
    push(d);
  }
  for (const d of listVersionDirs(
    join(HOME_DIR, '.workbuddy', 'binaries', 'node', 'versions'),
    '22',
  )) {
    push(d);
  }
  push(join(PROGRAM_FILES, 'nodejs22'));
  push(join(LOCALAPPDATA_DIR, 'Programs', 'nodejs22'));
  return out;
}

/** 返回本机首个可用的 Node 22（{dir, exe, version}）；找不到返回 null。 */
function findNode22() {
  for (const dir of node22Candidates()) {
    const exe = IS_WIN ? join(dir, 'node.exe') : join(dir, 'bin', 'node');
    if (!existsSync(exe)) continue;
    const probe = spawnSync(exe, ['-v'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const version = String(probe.stdout ?? '').trim();
    if (version.startsWith(`v${REQUIRED_NODE_MAJOR}.`)) return { dir, exe, version };
  }
  return null;
}

const children = [];
let shuttingDown = false;

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function err(msg) {
  process.stderr.write(`${msg}\n`);
}

/**
 * 校验当前 Node 主版本是否为仓库锁定的版本。
 * 不匹配时打印可操作提示（含本机已找到的 Node 22 路径）并退出；
 * 设 WB_ALLOW_NODE_MISMATCH=1 可跳过检查，但会明确告警其「跳过了不等于修好了」。
 */
function assertNodeVersion() {
  const current = process.versions.node;
  const abi = process.versions.modules;
  const major = Number.parseInt(current.split('.')[0], 10);
  if (major === REQUIRED_NODE_MAJOR) return;

  const headline = `Node 版本不匹配：当前 v${current}（ABI ${abi}），本工作台锁定 Node ${REQUIRED_NODE_MAJOR}.x（ABI ${REQUIRED_NODE_ABI}）。`;

  if (process.env.WB_ALLOW_NODE_MISMATCH === '1') {
    err(`\n⚠ ${headline}`);
    err('  已设 WB_ALLOW_NODE_MISMATCH=1，跳过版本检查继续启动。');
    err(
      `  ⚠ 但本仓库的 better-sqlite3 就是按 Node ${REQUIRED_NODE_MAJOR} 编译的：除非你已为当前 Node`,
    );
    err('    重新安装过依赖，否则接下来仍会报 ERR_DLOPEN_FAILED。\n');
    return;
  }

  const found = findNode22();

  err('');
  err('────────────────────────────────────────────');
  err(headline);
  err('原因：better-sqlite3 是原生模块，其二进制按 ABI 编译绑定，不能跨 Node 大版本使用；');
  err('      用当前版本继续启动，会在打开数据库时报 ERR_DLOPEN_FAILED。');
  err('');
  if (found) {
    err(`本机已找到 Node ${REQUIRED_NODE_MAJOR}：${found.dir}（${found.version}）`);
  } else {
    err(
      `未在本机常见位置找到 Node ${REQUIRED_NODE_MAJOR}（已查 WB_NODE_HOME / nvm / fnm / asdf / Volta / 用户级工具链）。`,
    );
  }
  err('解决（任选其一）：');
  if (found) {
    err(`  1. cmd 里执行： set "PATH=${found.dir};%PATH%"   然后 pnpm start`);
    err(
      `  2. 设 WB_NODE_HOME=${found.dir}，再双击 start.cmd（双击入口会自动选它，并打印选中的路径）`,
    );
  } else {
    err(`  1. 安装 Node ${REQUIRED_NODE_MAJOR}（nvm-windows / fnm 用户可直接用仓库根的 .nvmrc）`);
    err(
      `  2. 若本机别处已有 Node ${REQUIRED_NODE_MAJOR}：设 WB_NODE_HOME=<该目录>，再双击 start.cmd`,
    );
  }
  err('  3. 确认就要以当前 Node 运行：切到该版本后重新 pnpm install，重装原生模块');
  err(
    `  4. 强行跳过本检查：设 WB_ALLOW_NODE_MISMATCH=1 —— ⚠ 本仓库的二进制仍按 Node ${REQUIRED_NODE_MAJOR}`,
  );
  err('     编译，跳过后照样 ERR_DLOPEN_FAILED，仅在你已为当前 Node 重装过依赖时才有意义');
  err('────────────────────────────────────────────');
  process.exit(1);
}

/** 起一个子进程并把 stdout/stderr 加上前缀转发到本进程。 */
function startChild(name, command, args, options) {
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  const tag = `[${name}] `;
  const pipe = (stream, sink) => {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) sink.write(`${tag}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    log(`\n[${name}] 进程已退出（code=${code ?? '-'} signal=${signal ?? '-'}）`);
    shutdown(code ?? 0);
  });
  children.push({ name, child });
  return child;
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) killTree(child);
  process.exit(code);
}

function isPortFree(port) {
  return new Promise((res) => {
    const srv = createServer();
    srv.once('error', () => res(false));
    srv.once('listening', () => srv.close(() => res(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/** 从 start 起向后找首个空闲端口（跳过 exclude 中的端口），找不到返回 null。 */
async function findFreePort(start, count, exclude = []) {
  for (let p = start; p < start + count; p++) {
    if (exclude.includes(p)) continue;
    if (await isPortFree(p)) return p;
  }
  return null;
}

/**
 * 解析一个可用端口：
 * - 基准端口空闲 → 直接采用；
 * - 被占用且开启 WB_AUTO_PORT → 从基准端口起向上找首个空闲端口；
 * - 被占用且未开自动分配 → 返回 conflict（由调用方报错退出）。
 * @returns {Promise<{port?: number, conflict?: boolean, exhausted?: boolean}>}
 */
async function resolvePort(base, label, exclude = []) {
  if (!exclude.includes(base) && (await isPortFree(base))) return { port: base };
  if (!AUTO_PORT) return { conflict: true };
  const alt = await findFreePort(base + 1, AUTO_PORT_SCAN, exclude);
  if (alt === null) return { exhausted: true };
  log(`› 端口 ${base} 已被占用，${label}自动改用 ${alt}。`);
  return { port: alt };
}

function runBuild() {
  log('› 构建后端与依赖包（pnpm --filter @workbench/server... build）…');
  const res = spawnSync('pnpm', ['--filter', '@workbench/server...', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: IS_WIN,
  });
  if (res.status !== 0) {
    log('\n构建失败，已中止启动。请先修掉构建错误，或用 WB_SKIP_BUILD=1 直用上次产物。');
    process.exit(res.status ?? 1);
  }
}

function waitReady(url, timeoutMs, expectUp = true) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((res, rej) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        rej(new Error(`等待就绪超时：${url}`));
        return;
      }
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 1500);
        const r = await fetch(url, { signal: controller.signal });
        clearTimeout(t);
        if (expectUp && r.status > 0) {
          res();
          return;
        }
      } catch {
        /* 未就绪，继续轮询 */
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

function openBrowser(url) {
  try {
    if (IS_WIN) {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    log(`（无法自动打开浏览器，请手动访问 ${url}）`);
  }
}

async function main() {
  assertNodeVersion();

  log('个人 AI 全局工作台 · 一键启动');
  log(`  仓库    ${ROOT}`);
  log(`  数据目录 ${resolve(ROOT, DATA_DIR)}`);
  log('');

  if (!existsSync(SERVER_ENTRY) && SKIP_BUILD) {
    log(`未找到后端产物 ${SERVER_ENTRY}，且已跳过构建。请去掉 WB_SKIP_BUILD 重新运行。`);
    process.exit(1);
  }
  if (!existsSync(VITE_BIN)) {
    log(`未找到 vite（${VITE_BIN}）。请先在仓库根执行 pnpm install。`);
    process.exit(1);
  }

  const backend = await resolvePort(PORT, '后端');
  if (backend.conflict) {
    log(
      `端口 ${PORT} 已被占用。用 WB_PORT=<其他端口> pnpm start 换一个，或用 WB_AUTO_PORT=1 自动分配。`,
    );
    process.exit(1);
  }
  if (backend.exhausted) {
    log(`后端端口 ${PORT} 起连续 ${AUTO_PORT_SCAN} 个端口均被占用，无法自动分配。`);
    process.exit(1);
  }
  PORT = backend.port;

  // 前端端口不与后端端口相同
  const web = await resolvePort(WEB_PORT, '前端', [PORT]);
  if (web.conflict) {
    log(
      `前端端口 ${WEB_PORT} 已被占用。用 WB_WEB_PORT=<其他端口> pnpm start 换一个，或用 WB_AUTO_PORT=1 自动分配。`,
    );
    process.exit(1);
  }
  if (web.exhausted) {
    log(`前端端口 ${WEB_PORT} 起连续 ${AUTO_PORT_SCAN} 个端口均被占用，无法自动分配。`);
    process.exit(1);
  }
  WEB_PORT = web.port;

  if (!SKIP_BUILD) runBuild();

  log(`\n› 启动后端 http://127.0.0.1:${PORT} …`);
  const server = startChild('server', process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: String(PORT), WB_DATA_DIR: DATA_DIR },
  });

  log(`› 启动前端 http://127.0.0.1:${WEB_PORT} …`);
  startChild(
    'web',
    process.execPath,
    [VITE_BIN, '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'],
    {
      cwd: join(ROOT, 'apps', 'web'),
      env: { ...process.env, WB_API_PORT: String(PORT) },
    },
  );

  try {
    await waitReady(`http://127.0.0.1:${PORT}/api/v1/projects`, 30000);
    await waitReady(`http://127.0.0.1:${WEB_PORT}/`, 30000);
  } catch (err) {
    log(`\n${err.message}。请检查上方日志。`);
    shutdown(1);
    return;
  }

  const url = `http://127.0.0.1:${WEB_PORT}/`;
  log('\n────────────────────────────────────────────');
  log('  工作台已就绪');
  log(`  打开     ${url}`);
  log(`  后端 API http://127.0.0.1:${PORT}`);
  log('  停止     Ctrl+C（同时关闭前后端）');
  log('────────────────────────────────────────────');
  if (!NO_OPEN) openBrowser(url);

  void server;
}

process.on('SIGINT', () => {
  log('\n收到 Ctrl+C，正在关闭…');
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));

main().catch((err) => {
  console.error(err);
  shutdown(1);
});
