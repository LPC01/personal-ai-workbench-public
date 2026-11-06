# 用户手册

个人 AI 全局工作台：本地优先的个人 AI 工作系统，把多个彼此独立的项目统一到一个控制面，并通过对话创建、测试、安装和运行助手、工作流与小工具。

> **前置要求：Node 22.x + pnpm 10。** 本仓库锁定 Node 22（见 `.nvmrc`；`engines.node` = `>=22 <23`）。原因：SQLite 驱动 `better-sqlite3` 是**原生模块**，二进制按 Node 的 ABI 编译绑定，用 Node 23/24 会在**打开数据库**时报 `ERR_DLOPEN_FAILED`。`pnpm start` 与双击 `start.cmd` 都会在**构建之前**校验版本并打印可操作提示。
>
> **双击 `start.cmd` 时若 PATH 上的 `node` 不是 22，启动器会自动找 Node 22**（依次查 `WB_NODE_HOME`、nvm-windows、fnm、asdf、Volta、并排安装目录、用户级工具链），找到就**只为本次会话**把它前置到 PATH 并**打印选中的目录**；装在别处可先 `set WB_NODE_HOME=<该目录>`。
>
> 强行跳过版本检查（**只是跳过，不修 ABI 不匹配，仍会 `ERR_DLOPEN_FAILED`**）：设 `WB_ALLOW_NODE_MISMATCH=1`。**切换 Node 版本后须重新 `pnpm install`。**

## 1. 快速开始

```bash
pnpm install
pnpm start     # 一键启动：构建 → 起后端 → 起前端 → 打开浏览器
```

Windows 下也可直接双击仓库根目录的 `start.cmd`。就绪后浏览器打开 `http://127.0.0.1:5173` 进入控制台（后端 API 在 `http://127.0.0.1:4000`），按 `Ctrl+C` 同时关闭前后端。

需要分开启停时（例如只跑后端）：

```bash
pnpm --filter @workbench/server start   # 后端（单独起时默认 127.0.0.1:3000）
pnpm --filter @workbench/web dev        # 前端（默认 127.0.0.1:5173）
```

> 端口说明：单独起 server 时默认 `3000`；`pnpm start` 用 `4000`（避开本机常被 Hyper-V/Docker 保留的 3000），并把前端 `/api` 代理自动指向它。端口被占用时启动器**报错退出**；可用 `WB_PORT=<其他端口>` 换端口，或加 `WB_AUTO_PORT=1` 自动分配空闲端口。

## 2. 界面导航

| 视图       | 功能                                                                |
| ---------- | ------------------------------------------------------------------- |
| 项目       | 登记/移除登记、一键启动/停止运行时、查看日志、打开项目 Web UI       |
| 运行       | Run 状态机（创建/取消）、SSE 实时日志、下载 Artifact                |
| Agent 执行 | 发起 Agent Run（Harness/模型 Profile）、发送回合、取消/恢复、事件流 |
| 模型       | Provider / Profile / 凭据管理、模型探测                             |
| 工坊       | Schema UI（JSON Schema 驱动表单）、沙箱 iframe                      |
| Issue      | 问题 → 解决 → 验证 → 晋升经验（Lesson）                             |
| 用量       | 模型调用 token、延迟、成本（按模型/按天）                           |
| 诊断       | 一键健康检查（数据库 / Schema / Memory）                            |
| 聊天室     | 多智能体房间编排（Room Run：参与者、预算、评审、证据）              |
| 记忆中心   | 记忆候选收件箱、资源导入、召回审计                                  |

## 3. 核心流程

### 3.1 登记项目、启动与移除登记

1. 进入「项目」视图，展开左侧「登记新项目」，用两种方式之一登记（工作台**不扫描磁盘**，必须提交完整 manifest）：
   - **表单模式（默认，推荐）**：填必填 4 项（项目 ID / 名称 / 根目录 / 描述），再按需勾选「端口段 / 启动命令 / Web UI 健康检查」，底部预览即将要提交的 manifest，点「登记」；
   - **JSON 模式**：切换到「JSON」，粘贴一份完整 `workbench.project/v1` manifest（含 `models` / `memory` / 多命令等表单未覆盖字段时用这个）。
     也可以走 API（`POST /api/v1/projects/register`）或批量脚本（见 §3.5）。
2. 在左侧项目列表选中项目，点「启动并进入」启动运行时，点「打开项目 Web UI」访问项目页面。
3. 不再需要时点「移除登记」并二次确认。**只从工作台移除登记，不删除磁盘上的项目目录与 Artifact 内容**：
   - 项目未运行：直接注销，等价 `DELETE /api/v1/projects/{projectId}`；
   - 项目正在运行：服务端返回 `409 PROJECT_IN_USE`，界面转为「停止服务并移除」（等价加 `?force=1`，先停服务再注销）；
   - 注销前工作台会把 manifest 快照存到 `<WB_DATA_DIR>/removed-projects/`，并记录审计事件 `project.unregister`，事后可原样重新登记。

> 项目登记规则见 [项目对接规范](./project-integration-spec.md)，源码快照不附带运行截图。
>
> **准备把一个新项目接入工作台？** 先读 [新建项目对接规范](./project-integration-spec.md)：它写清了 manifest 该怎么填、项目代码必须满足哪些运行约定（端口读环境变量 / 提供健康端点 / 只监听 `127.0.0.1`），以及规避「登记成功但启动停在 `UNHEALTHY`」的自检清单。

### 3.2 运行 Job 与下载 Artifact

1. 发起 Run：`POST /api/v1/projects/{projectId}/commands/{commandId}/runs`（仅 `job` 类型命令可作为一次性 Run 运行）。
2. 实时查看 SSE 日志流（`GET /api/v1/runs/{runId}/stream`），或查看历史事件（`GET /api/v1/runs/{runId}/events`）。
3. 运行完成后下载 Artifact；需要中止时 `POST /api/v1/runs/{runId}/cancel`。

### 3.3 创建 Issue 并沉淀经验

1. 进入「Issue」视图，填写标题与描述。
2. 解决（resolve）→ 验证（verify）→ 晋升 Lesson（写入长期记忆，新会话可召回）。

### 3.4 发起 Agent Run

1. 进入「Agent 执行」视图，选择 Harness Profile 与模型 Profile，指定绑定项目与工具白名单，填写起始指令后发起（`POST /api/v1/agent-runs`）。
2. 运行中查看事件流（状态 / 消息 / 工具调用与结果），可继续发送回合（`POST /api/v1/agent-runs/{sessionId}/turns`）。
3. 中止用 `POST /api/v1/agent-runs/{sessionId}/cancel`；中断后续传用 `GET /api/v1/agent-runs/{sessionId}`（返回会话 + 游标之后的 Run 事件）。

### 3.5 批量登记本机项目

工作台**不会扫描磁盘**，项目必须逐份提交 manifest。批量登记走客户端工具：

```bash
WB_PROJECTS_ROOT=C:/Projects pnpm start                      # 带登记根启动（越出该根的 root 一律 403）
node scripts/register-projects.mjs --dry-run          # 预检：id 合法性 / root 是否为存在的绝对路径
node scripts/register-projects.mjs --api http://127.0.0.1:4000   # 真实登记
```

- 登记清单：`scripts/projects.registry.json`（每项是一份完整的 `workbench.project/v1` manifest）。
- **幂等**：已存在的项目显示「= 已存在，跳过」，不会覆盖也不会重复插入。
- **撤销**：`node scripts/register-projects.mjs --unregister`（经 `DELETE /api/v1/projects/{id}` 注销，幂等；项目在运行时加 `--force` 先停服务）。离线场景（server 未启动）可用 `--print-rollback-sql` 打印 5 张表的 DELETE 语句手工执行，顺序不可颠倒。
- 写 manifest 的两条硬约束：端口只能经**环境变量**注入（`runtime.port.environmentVariable`，写在 `arguments` 里的端口不生效）、`runtime.root` 用**绝对路径**。
- 完整接口和登记规则见 [项目对接规范](./project-integration-spec.md)。登记清单默认为空，示例位于 `scripts/projects.registry.example.json`。
- **新项目对接必须遵从的规范**：[新建项目对接规范](./project-integration-spec.md)（契约 + 运行约定 + 自检清单）；可复制模板 `templates/project/manifest.example.json`。

## 4. 备份与恢复

- 备份：`POST /api/v1/backup`（SQLite 一致性快照 + Manifest + 扩展 + Artifact 索引 + Memory + 配置）。
- 校验：`GET /api/v1/backup/verify`。
- 恢复：`POST /api/v1/restore`（校验哈希 → 临时验证 → 原子切换）。

详见 [灾难恢复手册](./disaster-recovery.md)。

## 5. Windows 安装 / 升级 / 卸载

详见 [Windows 安装、升级、卸载与数据保留](./windows-install.md)。要点：

- 卸载默认**保留数据**，`-Purge` 才删除数据。
- 升级自动备份后替换程序，数据保留。

## 6. 环境变量

一键启动器（`pnpm start`）：

| 变量                | 含义                            | 默认   |
| ------------------- | ------------------------------- | ------ |
| `WB_PORT`           | 后端端口（前端代理自动跟随）    | `4000` |
| `WB_WEB_PORT`       | 前端端口                        | `5173` |
| `WB_AUTO_PORT`      | 置 `1` 端口被占时自动找空闲端口 | 关     |
| `WB_AUTO_PORT_SCAN` | 自动分配时最多向后探测的端口数  | `50`   |
| `WB_DATA_DIR`       | 数据根目录                      | `var`  |
| `WB_SKIP_BUILD`     | 置 `1` 跳过构建，直用上次产物   | 关     |
| `WB_NO_OPEN`        | 置 `1` 不自动打开浏览器         | 关     |

后端与数据路径（`WB_DATA_DIR` 见上表）：

| 变量               | 含义                                                  | 默认                          |
| ------------------ | ----------------------------------------------------- | ----------------------------- |
| `PORT`             | 服务端口                                              | 3000                          |
| `WB_DB`            | 数据库路径                                            | `${WB_DATA_DIR}/workbench.db` |
| `WB_ARTIFACTS`     | Artifact 根                                           | `${WB_DATA_DIR}/artifacts`    |
| `WB_PROJECTS_ROOT` | 项目登记根（`runtime.root` 须落在其内；未设则不限制） | 不限制                        |
