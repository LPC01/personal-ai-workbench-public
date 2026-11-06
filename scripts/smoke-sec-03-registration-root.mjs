/*
 * SEC-03 真实冒烟：项目「登记根」约束（26 SPEC §5，known-limitations #11）。
 *
 * 真实 HTTP + 真实 server（须以 `WB_PROJECTS_ROOT=<root>` 启动）：
 *   - 登记根内绝对路径 → 200
 *   - 相对 ` . `（解析到登记根内）→ 200
 *   - 登记根外绝对路径 → 403 PATH_OUTSIDE_ROOT
 *   - 相对路径越级（`..`）→ 403 PATH_OUTSIDE_ROOT
 *   - 未配置登记根时不限制（本脚本不覆盖，见单元测试）
 *
 * 用法：
 *   WB_PROJECTS_ROOT=/abs/root PORT=4000 WB_DATA_DIR=/abs/var node apps/server/dist/index.js &
 *   WB_REG_ROOT=/abs/root node scripts/smoke-sec-03-registration-root.mjs
 * 环境：
 *   WB_API_URL   默认 http://127.0.0.1:4000
 *   WB_REG_ROOT  服务端同一登记根（绝对路径）；缺省用临时目录
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const API = process.env.WB_API_URL ?? 'http://127.0.0.1:4000';
const REG_ROOT = resolve(process.env.WB_REG_ROOT ?? mkdtempSync(join(tmpdir(), 'wb-regroot-')));

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function api(path, init) {
  const res = await fetch(API + path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const manifest = (id, root) => ({
  schemaVersion: 'workbench.project/v1',
  project: { id, name: `登记根演示 ${id}` },
  runtime: { root },
  commands: [{ id: 'noop', type: 'job', executable: process.execPath, arguments: ['-e', '0'] }],
});

async function main() {
  console.log(`登记根 = ${REG_ROOT}\n`);

  const inside = await api('/api/v1/projects/register', {
    method: 'POST',
    body: JSON.stringify(manifest('sec03-inside', join(REG_ROOT, 'proj-a'))),
  });
  check(
    '登记根内绝对路径 → 200 且已登记',
    inside.status === 200 && inside.body?.rootPath === join(REG_ROOT, 'proj-a'),
    `status=${inside.status} root=${inside.body?.rootPath}`,
  );

  const rel = await api('/api/v1/projects/register', {
    method: 'POST',
    body: JSON.stringify(manifest('sec03-rel', '.')),
  });
  check(
    '相对 ` . ` 解析到登记根内 → 200',
    rel.status === 200 || rel.body?.error?.code === 'PROJECT_ALREADY_EXISTS',
    `status=${rel.status}`,
  );

  const outside = await api('/api/v1/projects/register', {
    method: 'POST',
    body: JSON.stringify(manifest('sec03-outside', tmpdir())),
  });
  check(
    '登记根外绝对路径 → 403 PATH_OUTSIDE_ROOT',
    outside.status === 403 && outside.body?.error?.code === 'PATH_OUTSIDE_ROOT',
    `status=${outside.status} code=${outside.body?.error?.code}`,
  );

  const escape = await api('/api/v1/projects/register', {
    method: 'POST',
    body: JSON.stringify(manifest('sec03-escape', '../escape')),
  });
  check(
    '相对越级 `..` → 403 PATH_OUTSIDE_ROOT',
    escape.status === 403 && escape.body?.error?.code === 'PATH_OUTSIDE_ROOT',
    `status=${escape.status} code=${escape.body?.error?.code}`,
  );

  const list = await api('/api/v1/projects');
  const ids = (list.body?.items ?? []).map((p) => p.id);
  check(
    '被拒项目未落库（仅根内/相对项已登记）',
    ids.includes('sec03-inside') && !ids.includes('sec03-outside') && !ids.includes('sec03-escape'),
    ids.join(','),
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n== ${passed}/${results.length} checks passed ==`);
  if (passed !== results.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
