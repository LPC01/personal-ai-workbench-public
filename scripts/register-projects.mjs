#!/usr/bin/env node
/**
 * 批量登记 / 注销项目到工作台（26 SPEC §5 项目 Manifest / §10.1 Project Catalog）。
 *
 * 背景：`POST /api/v1/projects/register` 只接受**完整 manifest**，服务端不会扫目录；
 * 项目端点没有 update。因此本脚本承担「清单 → 逐个注册/注销 → 汇总」的职责，
 * 并对「已存在」做幂等跳过（不报错、不覆盖）。
 *
 * 注销走 `DELETE /api/v1/projects/{id}`（规范外扩展：26 SPEC §10.1 无 delete 端点；
 * 语义是**只注销登记，不删磁盘目录**），运行中的项目需显式 `--force`。
 *
 * 用法：
 *   node scripts/register-projects.mjs --dry-run          # 只做本地预检，不发请求
 *   node scripts/register-projects.mjs --api http://127.0.0.1:4000
 *   node scripts/register-projects.mjs --only a,b --skip c
 *   node scripts/register-projects.mjs --emit             # 另把 manifest 写到各项目根
 *   node scripts/register-projects.mjs --unregister       # 注销清单里的项目（幂等）
 *   node scripts/register-projects.mjs --unregister --force   # 运行中也一并停止并注销
 *   node scripts/register-projects.mjs --print-rollback-sql   # 离线 SQL 回滚（备选）
 *
 * 参数：
 *   --api <url>            后端地址（默认 http://127.0.0.1:4000）
 *   --file <path>          本地登记清单（默认 scripts/projects.registry.json；从示例复制并配置）
 *   --dry-run              只预检，不调用注册接口
 *   --only <id,id>         只处理这些 id
 *   --skip <id,id>         跳过这些 id
 *   --emit                 额外把 manifest 写入 <root>/workbench.project.json
 *   --unregister           注销（移除登记）而不是注册
 *   --force                配合 --unregister：先停止运行中的服务再注销
 *   --print-rollback-sql   打印离线回滚 SQL（server 未启动时手工执行）
 *   --help                 显示本帮助
 *
 * 仅使用 Node 内置模块（fetch 为 Node 18+ 全局），无第三方依赖。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;

function parseArgs(argv) {
  const out = { api: 'http://127.0.0.1:4000', file: 'scripts/projects.registry.json' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--emit') out.emit = true;
    else if (a === '--unregister') out.unregister = true;
    else if (a === '--force') out.force = true;
    else if (a === '--print-rollback-sql') out.rollback = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--api') out.api = argv[++i];
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--only') out.only = argv[++i];
    else if (a === '--skip') out.skip = argv[++i];
    else {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function printUsage() {
  console.log(
    [
      '批量登记项目到工作台',
      '',
      '  node scripts/register-projects.mjs [选项]',
      '',
      '  --api <url>           后端地址（默认 http://127.0.0.1:4000）',
      '  --file <path>         本地登记清单（默认 scripts/projects.registry.json；从示例复制并配置）',
      '  --dry-run             只预检，不调用注册接口',
      '  --only <id,id>        只处理这些 id',
      '  --skip <id,id>        跳过这些 id',
      '  --emit                额外把 manifest 写入 <root>/workbench.project.json',
      '  --unregister          注销（移除登记）而不是注册',
      '  --force               配合 --unregister：先停止运行中的服务再注销',
      '  --print-rollback-sql  打印离线回滚 SQL',
      '  --help                显示帮助',
    ].join('\n'),
  );
}

function ids(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 本地预检：不依赖服务端，先挡掉明显不合法的条目。 */
function precheck(manifest) {
  const problems = [];
  const id = manifest?.project?.id;
  const root = manifest?.runtime?.root;
  if (manifest?.schemaVersion !== 'workbench.project/v1') {
    problems.push('schemaVersion 必须是 workbench.project/v1');
  }
  if (!id || !ID_PATTERN.test(id)) {
    problems.push(`project.id 不合法: ${JSON.stringify(id)}（须为 ^[a-z][a-z0-9-]{2,63}$）`);
  }
  if (!manifest?.project?.name) problems.push('缺少 project.name');
  if (!root) problems.push('缺少 runtime.root');
  else if (!isAbsolute(root)) problems.push(`runtime.root 必须是绝对路径: ${root}`);
  else if (!existsSync(root)) problems.push(`runtime.root 目录不存在: ${root}`);
  return problems;
}

async function register(api, manifest) {
  const res = await fetch(`${api}/api/v1/projects/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}

function classify(result) {
  if (result.status === 200) return { kind: 'registered', detail: result.body?.manifestHash ?? '' };
  const code = result.body?.error?.code;
  if (result.status === 409 && code === 'PROJECT_ALREADY_EXISTS') return { kind: 'exists' };
  if (result.status === 403 && code === 'PATH_OUTSIDE_ROOT') return { kind: 'outside' };
  if (result.status === 422 && code === 'MANIFEST_INVALID') return { kind: 'invalid' };
  return {
    kind: 'error',
    detail: `${result.status} ${code ?? ''} ${result.body?.error?.message ?? ''}`,
  };
}

function rollbackSql(manifests) {
  const list = manifests.map((m) => `'${m.project.id}'`).join(', ');
  return [
    '-- 离线回滚 SQL（仅在 server 未启动时手工执行；在线请优先用 --unregister 调 DELETE 端点）',
    '-- 顺序不可颠倒：project_commands / runs / artifacts / room_projects 均 REFERENCES projects(id)',
    '-- 且无 ON DELETE CASCADE，artifacts / run_events 还引用 runs(id) —— 直接删 projects 会 FOREIGN KEY constraint failed。',
    '-- 停掉 server 后对 <WB_DATA_DIR>/workbench.db 执行：',
    `DELETE FROM room_projects WHERE project_id IN (${list});`,
    `DELETE FROM artifacts WHERE project_id IN (${list});`,
    `DELETE FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE project_id IN (${list}));`,
    `DELETE FROM runs WHERE project_id IN (${list});`,
    `DELETE FROM project_commands WHERE project_id IN (${list});`,
    `DELETE FROM projects WHERE id IN (${list});`,
  ].join('\n');
}

/** 注销项目：`DELETE /api/v1/projects/{id}`（只注销登记，不删除磁盘目录）。 */
async function unregisterProject(api, id, force) {
  const res = await fetch(
    `${api}/api/v1/projects/${encodeURIComponent(id)}?force=${force ? 1 : 0}`,
    { method: 'DELETE' },
  );
  let body;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}

function classifyRemoval(result) {
  if (result.status === 200) {
    const cascade = result.body?.cascade;
    return {
      kind: 'removed',
      detail: cascade
        ? `清理 命令 ${cascade.commands} · Run ${cascade.runs} · 事件 ${cascade.runEvents} · Artifact ${cascade.artifacts} · 房间绑定 ${cascade.roomProjects}`
        : '',
    };
  }
  const code = result.body?.error?.code;
  if (result.status === 404 && code === 'PROJECT_NOT_FOUND') return { kind: 'absent' };
  if (result.status === 409 && code === 'PROJECT_IN_USE') return { kind: 'inUse' };
  return {
    kind: 'error',
    detail: `${result.status} ${code ?? ''} ${result.body?.error?.message ?? ''}`.trim(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return 0;
  }

  const registryPath = resolve(ROOT, args.file);
  if (!existsSync(registryPath)) {
    console.error(`登记清单不存在: ${registryPath}`);
    return 2;
  }
  const all = JSON.parse(readFileSync(registryPath, 'utf8'));
  if (!Array.isArray(all)) {
    console.error('登记清单必须是 manifest 数组');
    return 2;
  }

  const only = new Set(ids(args.only));
  const skip = new Set(ids(args.skip));
  const manifests = all.filter((m) => {
    const id = m?.project?.id;
    if (only.size > 0 && !only.has(id)) return false;
    if (skip.has(id)) return false;
    return true;
  });

  console.log(`清单: ${registryPath}`);
  console.log(`待处理 ${manifests.length} / 共 ${all.length} 个项目\n`);

  if (args.rollback) {
    console.log(rollbackSql(manifests));
    return 0;
  }

  if (args.unregister) {
    const removal = { removed: 0, absent: 0, inUse: 0, error: 0 };
    const removalLines = [];
    for (const manifest of manifests) {
      const id = manifest?.project?.id;
      if (!id) {
        removal.error += 1;
        removalLines.push('  ✘ (无 id) — 跳过');
        continue;
      }
      const result = await unregisterProject(args.api, id, args.force);
      const verdict = classifyRemoval(result);
      removal[verdict.kind] += 1;
      const labels = {
        removed: '✔ 已移除登记',
        absent: '= 未登记，跳过',
        inUse: '✘ 项目在运行（加 --force 停止并移除）',
        error: '✘ 失败',
      };
      removalLines.push(
        `  ${labels[verdict.kind]} ${id}${verdict.detail ? ` — ${verdict.detail}` : ''}`,
      );
    }
    console.log(removalLines.join('\n'));
    console.log(
      `\n汇总: 已移除 ${removal.removed} · 未登记 ${removal.absent} · 运行中 ${removal.inUse} · 失败 ${removal.error}`,
    );
    return removal.error + removal.inUse > 0 ? 1 : 0;
  }

  const tallies = {
    registered: 0,
    exists: 0,
    outside: 0,
    invalid: 0,
    error: 0,
    blocked: 0,
    dryRun: 0,
  };
  const lines = [];

  for (const manifest of manifests) {
    const id = manifest?.project?.id ?? '(无 id)';
    const problems = precheck(manifest);
    if (problems.length > 0) {
      tallies.blocked += 1;
      lines.push(`  ✘ ${id} — 预检未通过`);
      for (const p of problems) console.log(`      · ${p}`);
      continue;
    }

    if (args.dryRun) {
      tallies.dryRun += 1;
      lines.push(`  · ${id} — 预检通过（dry-run 未注册）`);
      continue;
    }

    const result = await register(args.api, manifest);
    const verdict = classify(result);
    tallies[verdict.kind] += 1;

    const labels = {
      registered: '✔ 已登记',
      exists: '= 已存在，跳过',
      outside: '✘ 越出登记根（403 PATH_OUTSIDE_ROOT）',
      invalid: '✘ manifest 不合法（422）',
      error: '✘ 失败',
    };
    lines.push(
      `  ${labels[verdict.kind] ?? verdict.kind} ${id}${verdict.detail ? ` — ${verdict.detail}` : ''}`,
    );

    if (verdict.kind === 'invalid' && result.body?.error?.details?.issues) {
      for (const issue of result.body.error.details.issues) {
        console.log(`      · ${issue.instancePath ?? ''} ${issue.message ?? ''}`);
      }
    }

    if (args.emit) {
      const target = resolve(manifest.runtime.root, 'workbench.project.json');
      writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      console.log(`      → 已写入 ${target}`);
    }
  }

  console.log(lines.join('\n'));
  const parts = [
    `已登记 ${tallies.registered}`,
    `已存在 ${tallies.exists}`,
    `越界 ${tallies.outside}`,
    `不合法 ${tallies.invalid}`,
    `失败 ${tallies.error}`,
    `未注册 ${tallies.blocked}`,
  ];
  if (args.dryRun) parts.push(`预检通过 ${tallies.dryRun}`);
  console.log(`\n汇总: ${parts.join(' · ')}`);

  const failed = tallies.outside + tallies.invalid + tallies.error + tallies.blocked;
  if (failed > 0)
    console.log(`\n提示: 未成功的条目见上方逐条输出。回滚 SQL 可用 --print-rollback-sql 查看。`);
  return failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
