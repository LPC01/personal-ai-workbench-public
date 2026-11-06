# 开发手册

本文档面向开发者，说明个人 AI 全局工作台的架构、开发流程与验证基线。

## 1. 架构与依赖方向

```text
apps/                      # web（React+Vite）、server（Fastify）
packages/
  contracts/               # 纯类型契约 + 校验器（不 import node: 模块）
  domain/                  # 纯逻辑（状态机、错误码）
  persistence/             # SQLite 存储（依赖 contracts+domain）
  project-runtime/         # 项目目录/运行时变量/SSE hub
  workflow-runner/         # Workflow 确定性 Runner
  execution-gateway/       # 执行网关闭环（Harness 适配）
  model-gateway/           # 模型 Provider/Profile/凭据/适配器
  memory-gateway/          # 长期记忆（MemoryProvider + 降级）
```

依赖方向：`apps → application packages → domain/contracts`。

## 2. 验证命令（提交门）

```bash
pnpm typecheck     # TypeScript strict 全量类型检查
pnpm lint          # ESLint flat config
pnpm format        # Prettier 格式化
pnpm format:check  # 格式检查
pnpm test          # Vitest 全量测试
pnpm build         # 构建（子包 tsc --noEmit）
pnpm docs:check    # 文档检查器（占位符/链接/新鲜度）
```

六项全绿为提交门。

> **注意**：根 `pnpm typecheck` / `build` 使用根 `tsconfig.json`，其 `include` 只有 `tests/**/*.ts` 与 `vitest.config.ts` —— 实测 `--listFiles` 命中 `apps/web` 文件数为 **0**。
> 因此**动了 `apps/web` 时必须额外跑 `pnpm --filter @workbench/web typecheck`**（known-limitations #18）。

日常运行不在门禁内：`pnpm start`（或 Windows 双击 `start.cmd`）一键拉起后端 + 前端并打开浏览器，端口与可调环境变量见 [用户手册 §1](./user-manual.md#1-快速开始)。

## 3. 新增一个 SDD 任务

1. 认领编号任务（每次只认领一个）。
2. 按 `AGENTS.md` 的 Orient→Select→Inspect→Plan→Implement→Verify→Evidence→Update Docs→Close 协议执行。
3. 实施前输出 13 字段（规范依据 / 直接依赖 / 公共契约变化 / 数据库影响 / 安全风险 / 真实冒烟计划 / 当前阻塞等）。
4. 完成后记录检查结果；日志、截图和运行数据放在被忽略的 `var/verification/`，不提交到源码仓库。

## 4. 数据库与 migration

- migration 单向编号、事务化、可重复启动（`packages/persistence/src/migrations/`）。
- 新增表：加 `<nnnn>-<name>.ts` 并在 `migrations/index.ts` 注册。
- 数据目录默认 `var/`，可用 `WB_DATA_DIR` / `WB_DB` / `WB_ARTIFACTS` 覆盖。

## 5. 关键约定

- 包 scope：`@workbench/*`。
- SQLite 驱动：better-sqlite3（native prebuilt），pnpm 需在根 `pnpm.onlyBuiltDependencies` 白名单登记。
- **Node 版本锁定在 22.x**（`.nvmrc` + `engines.node: ">=22 <23"`），因为 `better-sqlite3` 是原生模块、二进制按 ABI 绑定。**改这条锁定的四处必须同时改**：`.nvmrc`、`package.json` 的 `engines.node`、`scripts/start.mjs` 的 `REQUIRED_NODE_MAJOR`/`REQUIRED_NODE_ABI`、`start.cmd` 的版本比较字面量 —— `tests/contract/node-version-pin.test.ts` 会因任一处漂移而失败。启动器闸门**必须在构建之前**（同测试守护）。可复跑冒烟：`node scripts/smoke-node-version-gate.mjs`。
- **Node 22 探测根也是两侧成对的**：`start.mjs` 的 `node22Candidates()` 与 `start.cmd` 的 `call :try_node` 段必须扫同一批位置（`WB_NODE_HOME` / `NVM_SYMLINK` / `NVM_HOME` / `AppData\nvm` / `.fnm` / `.asdf` / `Volta` / 用户级工具链 / `nodejs22`）。**新增探测根要两处一起改**，否则「双击找得到、报错里却给不出路径」就会脱节（同契约测试守护，另有「不得硬编码 `C:\Users\…`」的反向断言）。替用户换解释器时**必须打印选中的目录**，不得静默。
- 错误码：`packages/domain/src/errors.ts`（新增需同步 `errors.test.ts` 计数断言）。
- 项目注销：`DELETE /api/v1/projects/{id}`（`?force=1` 先停服务）是 **26 SPEC §10.1 之外的扩展端点**，语义为「只注销登记、不删磁盘目录」；级联清理顺序见 `ProjectCatalog.remove`（4 张表 `REFERENCES projects(id)` 且无 `ON DELETE CASCADE`，顺序不可颠倒）。
- 项目登记：唯一后端入口是 `POST /api/v1/projects/register`，只接受完整 manifest（工作台**不扫描磁盘**）。UI 的「表单模式」只是产出 manifest 的一种方式 —— 组装/校验逻辑在 `apps/web/src/manifest-draft.ts`（纯函数，可单测），产物仍交服务端裁决。
- 项目侧对接要求（端口注入 / 健康端点 / `127.0.0.1` / 约 2 秒启动窗口 / 端口不得进 `arguments`）集中写在 [`project-integration-spec.md`](./project-integration-spec.md)；改动 `packages/project-runtime` 或登记契约时**须同步该文件**，并在其附录 B 补新的实现落点。
- 前端纯逻辑放纯函数模块（不碰 React/DOM）并配单测：根 `vitest.config.ts` 的 `include` 含 `apps/**/*.test.ts`，故 `apps/web/src/__tests__/*.test.ts` 会被 `pnpm test` 自动收载，无需为 `apps/web` 引入 vitest 配置。
- 视觉验收截图：后端端口须与前端 vite 代理一致 —— 代理目标由 **`WB_API_PORT`** 决定（vite 直跑缺省 `3000`；经 `pnpm start` 启动时注入为 `WB_PORT`，默认 `4000`）。临时文件放 `var/`。

## 6. 相关文档

- [新建项目对接规范](./project-integration-spec.md)
- [用户手册](./user-manual.md)
- [灾难恢复手册](./disaster-recovery.md)
- [Windows 安装/升级/卸载](./windows-install.md)
- [变更历史](../CHANGELOG.md)
