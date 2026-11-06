// 验证 scripts/start.mjs 的「Node 版本闸门」是否真的拦得住、且不误拦。
//   第 1 段：用非锁定版本的 Node 启动 → 被拦（退出码非 0、给出可操作提示、且「未启动任何进程」）
//   第 2 段：同上 + WB_ALLOW_NODE_MISMATCH=1 → 闸门放行（出现「启动后端」）
//   第 3 段：用锁定的 Node 22 启动 → 正常跑到「工作台已就绪」
//   第 4 段：模拟双击 start.cmd（PATH 里只有非锁定 Node）→ 自动选中本机 Node 22 并跑到就绪
//   第 5 段：同上但所有探测根不可用 → 打印拦截块、退出码非 0、未启动任何进程
// 用法：node scripts/smoke-node-version-gate.mjs
//       须用 Node 22 运行（第 3/4 段依赖原生模块可用）；
//       另一版本 Node 由 WB_OTHER_NODE 指定，未指定则自动探测常见路径，探测不到则跳过 1/2/4/5 段。
// 前置：pnpm -r build（需 apps/server/dist 存在）；脚本用 WB_SKIP_BUILD=1，不触发构建。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve('.');
const START = join(REPO, 'scripts', 'start.mjs');
const START_CMD = 'start.cmd';
const DATA_DIR = join(REPO, 'var', 'gate-smoke-data');
const LOCKED_MAJOR = 22;
const GATE_MARK = 'Node 版本不匹配';
// 只有「拦截块」才含此文案；逃生放行时只打印一行告警，不含它。
const GATE_BLOCK_MARK = '解决（任选其一）';
// start.cmd 的拦截块是纯 ASCII 文案（双击时控制台代码页不可控），标记随之不同。
const CMD_GATE_BLOCK_MARK = '[ERROR] Node 22 is required';
const LAUNCH_MARK = '启动后端';
const READY_MARK = '工作台已就绪';
const PICK_MARK = 'Node 22 selected:';

const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};
let failed = 0;
let skipped = 0;
const assert = (name, cond, detail = '') => {
  log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  |  ${detail}` : ''}`);
  if (!cond) failed += 1;
};
const skip = (name, why) => {
  log(`SKIP  ${name}  |  ${why}`);
  skipped += 1;
};

const majorOf = (nodeExe) => {
  const r = spawnSync(nodeExe, ['-e', 'process.stdout.write(process.versions.node)'], {
    encoding: 'utf8',
  });
  if (r.status !== 0) return null;
  return Number.parseInt(String(r.stdout).split('.')[0], 10);
};

/** 收集子进程输出；命中 waitFor 任一标记，或进程退出/超时即结束（并杀掉进程树）。 */
function collect(child, waitFor = [], timeoutMs = 30000) {
  return new Promise((res) => {
    let out = '';
    let done = false;
    const finish = (reason) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (child.exitCode === null) {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          child.kill('SIGTERM');
        }
      }
      setTimeout(() => res({ out, code: child.exitCode, reason }), 600);
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    const onData = (chunk) => {
      out += chunk;
      if (waitFor.some((m) => out.includes(m))) finish('matched');
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code, signal) => finish(`exit:${code ?? signal}`));
  });
}

/** 起一个 start.mjs，收集输出。 */
function runStart(nodeExe, env, { waitFor = [], timeoutMs = 30000 } = {}) {
  const child = spawn(nodeExe, [START], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return collect(child, waitFor, timeoutMs);
}

/**
 * 模拟「资源管理器双击 start.cmd」：显式给一条受限 PATH（只含非锁定 Node），
 * 并用绝对路径的 cmd.exe 启动 —— 否则 cmd 自己都会因 PATH 受限而找不到。
 */
function runStartCmd({ pathDirs, env = {}, waitFor = [], timeoutMs = 90000 }) {
  const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/c', START_CMD], {
    cwd: REPO,
    env: { ...process.env, ...env, PATH: pathDirs.join(';') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return collect(child, waitFor, timeoutMs);
}

const SYSTEM_ROOT = process.env.SystemRoot ?? 'C:\\Windows';
/** 受限 PATH 的公共部分：系统目录 + npm 全局 shim（pnpm.cmd 在那）。 */
const BASE_PATH_DIRS = [
  join(SYSTEM_ROOT, 'system32'),
  SYSTEM_ROOT,
  process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null,
].filter(Boolean);

/** 把所有 Node 22 探测根都指向不存在的位置（验证「找不到时仍然硬拦」）。 */
const NO_NODE22_ENV = {
  USERPROFILE: 'C:\\_no_such_home',
  APPDATA: 'C:\\_no_such_appdata',
  LOCALAPPDATA: 'C:\\_no_such_localappdata',
  NVM_HOME: 'C:\\_no_such_nvm',
  NVM_SYMLINK: 'C:\\_no_such_nvm_symlink',
  ProgramFiles: 'C:\\_no_such_program_files',
};

/** 从输出里取出「已选中 Node 22」那一行，便于失败时定位。 */
const firstPick = (out) =>
  (out.split(/\r?\n/).find((line) => line.includes(PICK_MARK)) ?? '(无该行)').trim();

/** 兜底：按端口杀残留进程（Windows 下 taskkill /T 未必清干净）。 */
function killByPort(port) {
  if (process.platform !== 'win32') return;
  const net = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' }).stdout ?? '';
  for (const line of net.split(/\r?\n/)) {
    if (!/listen/i.test(line)) continue;
    if (!line.includes(`:${port} `)) continue;
    const pid = line.trim().split(/\s+/).pop();
    if (pid && /^\d+$/.test(pid)) {
      spawnSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
    }
  }
}

// ─── 前置：本脚本自身必须跑在锁定版本上 ─────────────────────────────────────
const selfMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
log('── 0. 前置检查 ─────────────────────────────────────────────');
assert(
  `本冒烟脚本以 Node ${LOCKED_MAJOR} 运行`,
  selfMajor === LOCKED_MAJOR,
  `当前 v${process.versions.node}`,
);

// 找一个非锁定版本的 Node
const candidates = [
  process.env.WB_OTHER_NODE,
  process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs', 'node.exe') : null,
  'C:\\Program Files\\nodejs\\node.exe',
].filter(Boolean);
let otherNode = null;
for (const c of candidates) {
  if (!existsSync(c)) continue;
  const m = majorOf(c);
  if (m !== null && m !== LOCKED_MAJOR) {
    otherNode = { path: c, major: m };
    break;
  }
}

// ─── 第 1 段：非锁定版本必须被拦 ────────────────────────────────────────────
log('');
log('── 1. 非锁定版本的 Node → 必须被闸门拦下（不启动任何进程） ─────');
if (!otherNode) {
  skip('非锁定版本被拦', '未找到非 22 的 Node（可用 WB_OTHER_NODE=<path> 指定）');
} else {
  log(`   使用：${otherNode.path}（Node ${otherNode.major}）`);
  const r = await runStart(otherNode.path, {
    WB_SKIP_BUILD: '1',
    WB_NO_OPEN: '1',
  });
  assert('退出码非 0', r.code !== 0, `code=${r.code} reason=${r.reason}`);
  assert('输出含闸门提示', r.out.includes(GATE_MARK));
  assert('打印了完整拦截块（含解决步骤）', r.out.includes(GATE_BLOCK_MARK));
  assert(
    '提示里点明了当前版本与要求版本',
    /v\d+\.\d+\.\d+/.test(r.out) && r.out.includes('Node 22'),
  );
  assert('给出了逃生开关名', r.out.includes('WB_ALLOW_NODE_MISMATCH'));
  assert(
    '报错里给出了「本机 Node 22 在哪」的定位结论',
    r.out.includes('本机已找到 Node') || r.out.includes('未在本机常见位置找到 Node'),
  );
  assert(
    '逃生开关说明点明「跳过了不等于修好了」',
    /WB_ALLOW_NODE_MISMATCH[\s\S]{0,400}ERR_DLOPEN_FAILED/.test(r.out),
  );
  assert(
    '未启动任何进程（关键：错误发生在构建/启动之前）',
    !r.out.includes(LAUNCH_MARK) && !r.out.includes(READY_MARK),
    r.out.includes(LAUNCH_MARK) ? '出现了「启动后端」' : '输出中无启动痕迹',
  );
}

// ─── 第 2 段：逃生开关可强行放行 ────────────────────────────────────────────
log('');
log('── 2. 同版本 + WB_ALLOW_NODE_MISMATCH=1 → 闸门放行 ────────────');
if (!otherNode) {
  skip('逃生开关放行', '未找到非 22 的 Node');
} else {
  const r = await runStart(
    otherNode.path,
    {
      WB_SKIP_BUILD: '1',
      WB_NO_OPEN: '1',
      WB_ALLOW_NODE_MISMATCH: '1',
      WB_PORT: '4193',
      WB_WEB_PORT: '5193',
      WB_DATA_DIR: DATA_DIR,
    },
    { waitFor: [LAUNCH_MARK], timeoutMs: 20000 },
  );
  assert('未打印完整拦截块（即没有因此退出）', !r.out.includes(GATE_BLOCK_MARK));
  assert('确认已放行（出现「启动后端」）', r.out.includes(LAUNCH_MARK));
  assert(
    '放行时给出显式告警（不是静默跳过）',
    r.out.includes('WB_ALLOW_NODE_MISMATCH=1') && r.out.includes(GATE_MARK),
    '输出应含跳过说明',
  );
  killByPort(4193);
  killByPort(5193);
}

// ─── 第 3 段：锁定版本必须正常通过 ──────────────────────────────────────────
log('');
log('── 3. 锁定的 Node 22 → 正常就绪（闸门不误拦） ─────────────────');
rmSync(DATA_DIR, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });
const ok = await runStart(
  process.execPath,
  {
    WB_SKIP_BUILD: '1',
    WB_NO_OPEN: '1',
    WB_PORT: '4192',
    WB_WEB_PORT: '5192',
    WB_DATA_DIR: DATA_DIR,
  },
  { waitFor: [READY_MARK], timeoutMs: 60000 },
);
assert('未打印闸门提示', !ok.out.includes(GATE_MARK));
assert('跑到「工作台已就绪」', ok.out.includes(READY_MARK), `reason=${ok.reason}`);
assert('后端打印了监听地址', ok.out.includes('workbench server listening'));
killByPort(4192);
killByPort(5192);
rmSync(DATA_DIR, { recursive: true, force: true });

// ─── 第 4 段：双击入口在「PATH 里只有非锁定 Node」时必须自己找到 Node 22 ─────
log('');
log('── 4. 模拟双击 start.cmd（PATH 里只有非锁定 Node） → 自动选中 Node 22 ──');
if (!otherNode) {
  skip('双击入口自动选中 Node 22', '未找到非 22 的 Node（可用 WB_OTHER_NODE=<path> 指定）');
} else {
  const pathDirs = [dirname(otherNode.path), ...BASE_PATH_DIRS];
  log(`   受限 PATH：${pathDirs.join(' ; ')}`);
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const r = await runStartCmd({
    pathDirs,
    env: {
      WB_SKIP_BUILD: '1',
      WB_NO_OPEN: '1',
      WB_PORT: '4198',
      WB_WEB_PORT: '5198',
      WB_DATA_DIR: DATA_DIR,
      WB_ALLOW_NODE_MISMATCH: '', // 确保不靠逃生开关蒙混过关
    },
    waitFor: [READY_MARK],
    timeoutMs: 90000,
  });
  assert('自动选中了 Node 22 并打印了路径', r.out.includes(PICK_MARK), firstPick(r.out));
  assert('未打印拦截块（即没有靠用户切 PATH）', !r.out.includes(GATE_BLOCK_MARK));
  assert('跑到「工作台已就绪」', r.out.includes(READY_MARK), `reason=${r.reason}`);
  assert('后端打印了监听地址', r.out.includes('workbench server listening'));
  killByPort(4198);
  killByPort(5198);
  rmSync(DATA_DIR, { recursive: true, force: true });
}

// ─── 第 5 段：双击路径下找不到 Node 22 → 仍然硬拦，且不启动任何进程 ──────────
log('');
log('── 5. 同样双击 PATH + 所有探测根不可用 → 仍硬拦（不静默放行） ──');
if (!otherNode) {
  skip('找不到 Node 22 时仍硬拦', '未找到非 22 的 Node');
} else {
  const pathDirs = [dirname(otherNode.path), ...BASE_PATH_DIRS];
  const r = await runStartCmd({
    pathDirs,
    env: { ...NO_NODE22_ENV, WB_SKIP_BUILD: '1', WB_NO_OPEN: '1' },
    timeoutMs: 30000,
  });
  assert('退出码非 0', r.code !== 0, `code=${r.code} reason=${r.reason}`);
  assert('打印了完整拦截块（含解决步骤）', r.out.includes(CMD_GATE_BLOCK_MARK));
  assert('提示里给出了 WB_NODE_HOME 这条出路', r.out.includes('WB_NODE_HOME'));
  assert('未误报「已选中 Node 22」', !r.out.includes(PICK_MARK), firstPick(r.out));
  assert(
    '未启动任何进程',
    !r.out.includes(LAUNCH_MARK) && !r.out.includes(READY_MARK),
    r.out.includes(LAUNCH_MARK) ? '出现了「启动后端」' : '输出中无启动痕迹',
  );
}

log('');
log(
  failed === 0
    ? `ALL-PASS（0 失败${skipped ? `，${skipped} 跳过` : ''}）`
    : `FAILED（${failed} 项失败${skipped ? `，${skipped} 跳过` : ''}）`,
);
process.exitCode = failed === 0 ? 0 : 1;
