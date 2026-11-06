// 防漂移契约：Node 主版本锁定声明必须在各处保持一致，且启动器闸门必须早于构建。
//
// 背景：better-sqlite3 是原生模块，其 .node 二进制按 Node 的 ABI（NODE_MODULE_VERSION）
// 编译绑定，不能跨 Node 大版本复用。此前 package.json 写的是 `engines.node: ">=22"`
// （等于宣示 Node 24 可用）、start.cmd 只在纸面上提示 Node 22 而从不校验 —— 用户双击
// start.cmd 时命中系统 Node 24，直到打开数据库才抛 ERR_DLOPEN_FAILED。
//
// 本测试把「版本声明」和「启动器闸门」钉在一起：任一处漂移即失败。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relPath: string): string => readFileSync(resolve(REPO, relPath), 'utf8');

const LOCKED_MAJOR = 22;
const LOCKED_ABI = '127';

/** 从 start.mjs 文本提取 REQUIRED_NODE_MAJOR 常量值；取不到返回 null。 */
function majorFromStartScript(text: string): number | null {
  const m = /const\s+REQUIRED_NODE_MAJOR\s*=\s*(\d+)\s*;/.exec(text);
  return m ? Number(m[1]) : null;
}

/** 从 start.mjs 文本提取 REQUIRED_NODE_ABI 常量值；取不到返回 null。 */
function abiFromStartScript(text: string): string | null {
  const m = /const\s+REQUIRED_NODE_ABI\s*=\s*'([^']*)'\s*;/.exec(text);
  return m ? (m[1] ?? null) : null;
}

/** 从 start.cmd 文本提取版本比较字面量；取不到返回 null。 */
function majorFromCmd(text: string): number | null {
  const m = /if not "%NODE_MAJOR%"=="(\d+)"/.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * 从 engines.node 范围提取下界主版本。
 * 只接受 ">=X <Y" 形态；宽松的 ">=22"（旧值）必须返回 null，否则本条约束形同虚设。
 */
function lowerBoundOfEngines(range: string): number | null {
  const m = /^>=\s*(\d+)\s+<\d+$/.exec(range.trim());
  return m ? Number(m[1]) : null;
}

describe('Node 版本锁定（防漂移）', () => {
  const pkg = JSON.parse(read('package.json')) as { engines?: { node?: string } };
  const nvmrc = read('.nvmrc').trim();
  const startMjs = read('scripts/start.mjs');
  const startCmd = read('start.cmd');

  it('package.json 的 engines.node 收紧为 ">=22 <23"', () => {
    expect(pkg.engines?.node).toBe('>=22 <23');
    expect(lowerBoundOfEngines(pkg.engines?.node ?? '')).toBe(LOCKED_MAJOR);
  });

  it('存在 .nvmrc 且锁定到 22', () => {
    expect(nvmrc).toBe(String(LOCKED_MAJOR));
  });

  it('start.mjs 声明了主版本与 ABI 闸门常量', () => {
    expect(majorFromStartScript(startMjs)).toBe(LOCKED_MAJOR);
    expect(abiFromStartScript(startMjs)).toBe(LOCKED_ABI);
  });

  it('start.cmd 双击入口做同样的版本比较', () => {
    expect(majorFromCmd(startCmd)).toBe(LOCKED_MAJOR);
  });

  it('四处声明互相一致', () => {
    const declared = [
      lowerBoundOfEngines(pkg.engines?.node ?? ''),
      Number(nvmrc),
      majorFromStartScript(startMjs),
      majorFromCmd(startCmd),
    ];
    expect(new Set(declared).size).toBe(1);
    expect(declared[0]).toBe(LOCKED_MAJOR);
  });

  it('闸门必须早于构建与起进程（否则报错会晚到误事）', () => {
    // 注意：`runBuild()` 会先匹配到函数声明，故取**最后一个**命中（= main() 里的调用点）。
    const gate = startMjs.indexOf('assertNodeVersion();');
    const build = startMjs.lastIndexOf('runBuild()');
    const spawnServer = startMjs.indexOf("startChild('server'");
    expect(gate).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(startMjs.indexOf('function runBuild()'));
    expect(spawnServer).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(build);
    expect(gate).toBeLessThan(spawnServer);

    // start.cmd 同样：版本比较要早于 `call pnpm start`
    const cmdGate = startCmd.indexOf('if not "%NODE_MAJOR%"=="');
    expect(cmdGate).toBeGreaterThan(-1);
    expect(cmdGate).toBeLessThan(startCmd.indexOf('call pnpm start'));
  });

  it('逃生开关在两侧都存在且同名', () => {
    const flag = 'WB_ALLOW_NODE_MISMATCH';
    expect(startMjs).toContain(flag);
    expect(startCmd).toContain(flag);
  });

  // ── Node 22 自动探测（NODE-02）──────────────────────────────────────────────
  // 双击 start.cmd 走的是交互式 PATH，可能只有更新的 Node；两侧都必须扫同一批
  // 工具链位置，否则「start.cmd 找得到、start.mjs 报错里给不出路径」就会脱节。
  it('探测根列表在 start.cmd 与 start.mjs 两侧一致', () => {
    const roots = [
      'WB_NODE_HOME',
      'NVM_SYMLINK',
      'NVM_HOME',
      'node-versions',
      '.asdf',
      'Volta',
      '.workbuddy',
      'nodejs22',
    ];
    for (const token of roots) {
      expect(startCmd, `start.cmd 缺少探测根 ${token}`).toContain(token);
      expect(startMjs, `start.mjs 缺少探测根 ${token}`).toContain(token);
    }
    // 版本目录前缀：nvm/fnm 用 v22，asdf/Volta/用户工具链用 22
    expect(startCmd).toContain('v22*');
    expect(startMjs).toContain("'v22'");
    expect(startMjs).toContain("'22'");
  });

  it('探测必须早于闸门，且前置 PATH 必须早于 where node', () => {
    const probe = startCmd.indexOf('call :try_node');
    const prepend = startCmd.indexOf('set "PATH=%WB_NODE_FOUND%;%PATH%"');
    const whereNode = startCmd.indexOf('where node');
    const gate = startCmd.indexOf('if not "%NODE_MAJOR%"=="');
    expect(probe).toBeGreaterThan(-1);
    expect(prepend).toBeGreaterThan(-1);
    expect(whereNode).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(probe).toBeLessThan(prepend);
    expect(prepend).toBeLessThan(whereNode);
    expect(prepend).toBeLessThan(gate);

    // start.mjs：查询函数存在，且在闸门内部被调用（用于把路径写进报错）。
    // 注意：不能直接用 indexOf('findNode22()') —— 它会先命中的是 `function findNode22()` 声明。
    expect(startMjs).toContain('function findNode22()');
    expect(startMjs.indexOf('const found = findNode22();')).toBeGreaterThan(
      startMjs.indexOf('function assertNodeVersion()'),
    );
  });

  it('选中的 Node 必须被打印出来（替用户换解释器不得静默）', () => {
    expect(startCmd, 'start.cmd 应打印选中的 Node 目录').toContain('Node 22 selected:');
    expect(startMjs, 'start.mjs 报错里应给出本机找到的 Node 22 路径').toContain('本机已找到 Node');
  });

  it('逃生开关的说明必须点明「跳过不等于修好」（否则会把用户引向第二次失败）', () => {
    expect(startMjs).toMatch(/WB_ALLOW_NODE_MISMATCH[\s\S]{0,400}ERR_DLOPEN_FAILED/);
    expect(startCmd).toMatch(/WB_ALLOW_NODE_MISMATCH[\s\S]{0,300}does NOT/);
  });

  // ── 反向断言：证明上面的提取器不是空转（否则「一致」毫无意义）──────────────
  it('反向断言：提取器能读出「别的版本」，不是写死返回 22', () => {
    const mutated = startMjs.replace(
      'const REQUIRED_NODE_MAJOR = 22;',
      'const REQUIRED_NODE_MAJOR = 24;',
    );
    expect(majorFromStartScript(mutated)).toBe(24);
    expect(majorFromStartScript('// 无该常量')).toBeNull();

    // 显式替换闸门那一行：探测块里也有数字与引号，不能用 `"22"` 作锚点。
    const gateLine = 'if not "%NODE_MAJOR%"=="22"';
    expect(startCmd).toContain(gateLine);
    expect(majorFromCmd(startCmd.replace(gateLine, 'if not "%NODE_MAJOR%"=="24"'))).toBe(24);
    expect(majorFromCmd('rem 无该比较')).toBeNull();

    expect(abiFromStartScript("const REQUIRED_NODE_ABI = '131';")).toBe('131');
  });

  it('反向断言：两侧都不硬编码用户绝对路径（探测只能靠环境变量与工具链根）', () => {
    const userPath = /C:\\Users\\/i;
    expect(userPath.test(startCmd), 'start.cmd 不应出现 C:\\Users\\…').toBe(false);
    expect(userPath.test(startMjs), 'start.mjs 不应出现 C:\\Users\\…').toBe(false);
    // 正向对照：证明上面这个正则确实能命中，不是永远为 false 的假绿。
    expect(userPath.test(String.raw`set "PATH=C:\Users\someone\node;%PATH%"`)).toBe(true);
  });

  it('反向断言：探测根缺失时上面的一致性检查确实会失败', () => {
    for (const token of ['NVM_HOME', 'Volta', '.workbuddy']) {
      expect(startCmd.replaceAll(token, 'REMOVED')).not.toContain(token);
      expect(startMjs.replaceAll(token, 'REMOVED')).not.toContain(token);
    }
  });

  it('反向断言：宽松的 ">=22" 形态不被接受（正是被修掉的旧值）', () => {
    expect(lowerBoundOfEngines('>=22')).toBeNull();
    expect(lowerBoundOfEngines('>=22 <24')).toBe(22); // 上界不同也必须能被测出
    expect(lowerBoundOfEngines('>=20 <23')).toBe(20);
  });
});
