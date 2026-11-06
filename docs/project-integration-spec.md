# 新建项目对接个人 AI 全局工作台 · 规范

> **版本** v1.2 · **状态**：生效
> **适用范围**：所有要登记进本工作台的本机项目
> **阅读对象**：新建项目的开发者 / 维护者
> **一句话**：照这份规范做，项目就能被工作台**登记、启动、打开 Web UI**；不照它做，登记会返回 4xx，或者登记成功但启动停在 `UNHEALTHY`。
>
> **v1.2（2026-10-07，随 PROJ-UI-01 修订）**：§8 新增「README 简介」边界——工作台新增规范外扩展端点 `GET /api/v1/projects/:id/readme`，读取登记根**顶层**自述文件在「简介」页签渲染；`project.description` 会作为列表卡片简介回显。
> **v1.1（2026-10-07，随 RT-03 修订）**：R4 健康检查宽限期改为由 `timeoutSeconds` 控制（原固定约 2 秒）；§6 明确 `UNHEALTHY` 会回收进程与端口、**不阻塞重启**，停止为同步操作，新增 `GET /runtime` 状态查询。旧版「必须在约 2 秒内可服务」的硬性要求已放宽为按 `timeoutSeconds` 声明。

本文档是**交付给项目方**的规范，自包含——不需要阅读工作台源码即可执行。文中每条「必须」条款均标注了它在工作台侧的实现落点（见[附录 B](#附录-b必须条款与实现落点对照)），保证条款不是空话。

---

## 0. 效力与用法

### 0.1 规范性语言

| 用语     | 含义                                       |
| -------- | ------------------------------------------ |
| **必须** | 不满足即无法对接，登记或启动会失败         |
| **不得** | 违反会被服务端拒绝，或被安全约束拦截       |
| **应当** | 强烈建议；不满足可运行，但会产生已知副作用 |
| **可以** | 可选，按需使用                             |

### 0.2 与其它规范的关系

本规范只约束「**项目侧该怎么写**」与「**manifest 该怎么填**」。发生冲突时按以下顺序执行：

1. `AGENTS.md`（工作台仓库内 AI 协作入口）
2. 已采纳的 ADR
3. `26 号平台 SDD SPEC`（尤其 §5 Manifest 契约、§11 Runtime 与进程、§16 安全）
4. **本规范**
5. 工作台操作手册（[用户手册](./user-manual.md)）

本规范**不**规定工作台的内部实现；它只规定项目侧与 manifest 侧的硬性要求。

### 0.3 怎么用这份规范

1. **写项目代码时**，按 [§4 项目侧运行约定](#4-项目侧运行约定必须) 做（这是最容易被忽略、也最容易导致「登记成功但启动失败」的部分）。
2. **写 manifest 时**，按 [§3 登记契约](#3-登记契约必须) 填；可以直接复制 [templates/project/manifest.example.json](../templates/project/manifest.example.json)。
3. **提交登记前**，逐条过 [§9 自检清单](#9-对接自检清单)。
4. 启动失败时，查 [§7.3 错误码 → 处置映射表](#73-错误码--处置映射表) 与 [§6 运行语义](#6-登记后的运行语义应当知悉)。

### 0.4 变更流程

本规范由工作台维护方修订。项目方**不得**自行放宽条款；如认为某条不合理，应向工作台维护方提出，由维护方评估后修订本文件并更新版本号。

---

## 1. 适用范围

| 类别                                       | 是否适用  | 说明                                                         |
| ------------------------------------------ | --------- | ------------------------------------------------------------ |
| 自有、需要经工作台启动/托管的本机项目      | ✅ 适用   | 本文档的主要对象                                             |
| 无 Web UI、只提供作业命令（job）的工具项目 | ✅ 适用   | 只需满足 §3 契约 + §5 命令约束，跳过 §4 的端口与健康端点条款 |
| 工作台宿主自身（`personal-ai-workbench`）  | ❌ 不适用 | 登记会造成自引用                                             |
| 第三方开源参考仓库（只读参考）             | ❌ 不适用 | 不是自有项目，不应纳入托管                                   |
| 空目录 / 纯资料目录（只有零散文档与图片）  | ❌ 不适用 | 没有可执行入口，登记后无法启动                               |
| 工作台扩展包（Extension）                  | ❌ 不适用 | 走 `workbench.extension/v1` 契约（26 SPEC §6），另立规范     |

---

## 2. 对接总览

对接一个项目只有四步。**第 1 步是项目侧改造，第 2～4 步是登记与验收。**

```text
① 项目侧改造           ② 产出 manifest           ③ 提交登记              ④ 启动与验收
   §4 运行约定            §3 登记契约               §7 三种入口             §9 自检清单
   ───────────            ───────────              ───────────            ───────────
   读端口环境变量    ──▶   复制模板并改 5 处   ──▶  Web UI / CLI / REST ──▶  RUNNING + 打开 Web UI
   提供 /health 端点        填 id/name/root          POST .../register        （健康检查通过才 RUNNING）
   只监听 127.0.0.1        填端口段与启动命令        校验 + 落库
```

| 步骤 | 谁做       | 产物                                     | 完成标志                                    |
| ---- | ---------- | ---------------------------------------- | ------------------------------------------- |
| ①    | 项目开发者 | 可被外部指定端口拉起、且带健康端点的服务 | 本地用 `PORT=8123 node server.mjs` 能起     |
| ②    | 项目开发者 | 一份 `workbench.project/v1` manifest     | 字段齐、id 合法、root 为绝对路径            |
| ③    | 项目开发者 | 登记请求                                 | 返回项目对象，`GET /api/v1/projects` 能看到 |
| ④    | 项目开发者 | 运行中的服务                             | 状态 `RUNNING`，「打开项目 Web UI」可用     |

---

## 3. 登记契约（必须）

工作台**只接受**一份完整的 manifest（JSON 对象），按 [`schemas/project.schema.json`](../schemas/project.schema.json) 校验。**工作台不会去扫描目录、不会去推断你的技术栈**——这是刻意的安全取舍（避免猜错就拉起错进程）。

### 3.1 最小可用 manifest

必填只有 **4 个字段**：

```json
{
  "schemaVersion": "workbench.project/v1",
  "project": { "id": "my-app", "name": "我的应用" },
  "runtime": { "root": "C:/Projects/my-app" }
}
```

但**最小 ≠ 够用**：这份 manifest 登记后**没有任何可执行命令**，启动会失败（`COMMAND_NOT_REGISTERED`）。要能被启动并打开 Web UI，至少要补 `runtime.port` + `commands[]` + `webUI`，见 [§3.7](#37-commands必须当需要启动服务时)。

### 3.2 顶层字段总表

| 字段            | 必填 | 类型   | 约束                                  |
| --------------- | ---- | ------ | ------------------------------------- |
| `schemaVersion` | 必须 | string | **固定** `workbench.project/v1`       |
| `project`       | 必须 | object | 见 §3.3                               |
| `runtime`       | 必须 | object | 见 §3.4 / §3.5                        |
| `webUI`         | 可以 | object | 见 §3.6；无 Web UI 的项目省略         |
| `commands`      | 可以 | array  | 见 §3.7；**要能被启动则必须提供**     |
| `models`        | 可以 | object | 声明性字段，不影响登记与启动，见 §3.8 |
| `memory`        | 可以 | object | 声明性字段，不影响登记与启动，见 §3.8 |

> **`additionalProperties: false`（各层级均是）**：出现表中没有的字段会直接 `422 MANIFEST_INVALID`。不要凭直觉加字段。

### 3.3 `project.*`

| 字段          | 必填 | 约束                                                |
| ------------- | ---- | --------------------------------------------------- |
| `id`          | 必须 | 正则 `^[a-z][a-z0-9-]{2,63}$`，且**全局唯一**       |
| `name`        | 必须 | 非空字符串，用于界面显示                            |
| `description` | 可以 | 字符串，建议写清「技术栈 + 端口来源」，便于日后维护 |

`id` 命名规范（**必须**遵守）：

- 只能是小写字母、数字、连字符；**首字符必须是字母**；长度 3～64。
- **不得**用大写、下划线、空格、中文、点号。
- 一旦登记，`id` 是稳定标识：**没有 update 端点**，改名只能「移除登记 → 重新登记」。
- **应当**与项目目录名一致（如目录 `C:/Projects/my-app` → id `my-app`），降低认知负担。

### 3.4 `runtime.root`（必须）

**必须**写**绝对路径**，且解析后落在登记根内（登记根由工作台侧环境变量 `WB_PROJECTS_ROOT` 指定）。

> **为什么必须绝对路径**：登记期按「登记根」解析相对路径，而运行期按**服务进程的 cwd**解析——同一份相对路径在两处语义不一致。用绝对路径可完全规避这个不一致（该不一致本身已登记为已知限制）。

写法要求：

- Windows 用正斜杠，如 `C:/Projects/my-app`（**不得**写 `C:\Projects\my-app`）。
- **不得**以 `/` 结尾，**不得**写 `.` 或 `..`。
- 同一目录**只有一种写法**：唯一性判断是**字符串比较**，`C:\Projects\x` 与 `C:/Projects/x` 会被当成两个不同目录。

### 3.5 `runtime.port`（端口段）

| 字段                  | 必填 | 约束                                               |
| --------------------- | ---- | -------------------------------------------------- |
| `strategy`            | 必须 | **固定** `dynamic`                                 |
| `from` / `to`         | 必须 | 整数 1～65535，且 `from` ≤ `to`                    |
| `environmentVariable` | 可以 | 环境变量名（如 `PORT`）；**强烈建议提供**，见 §4.1 |

语义：

- 工作台在 `from`～`to` 内**从 `from` 起顺序**找一个**未被占用**的端口分配给本次启动；范围耗尽返回 `409 PORT_UNAVAILABLE`。
- **省略 `runtime.port` 时默认 `8100`～`8199`**——多个项目共用这个默认段会互相抢占，**应当**为每个项目分配专属小段。
- 端口段**不得**与已登记项目重叠，**应当**按 10 个一组分配（如 `8110`–`8119`）。
- 若项目自身**无法**读环境变量、只能固定端口（如某些 CLI 的 `--port` 默认值），可以把 `from` 与 `to` 设为**同一个值**，并把该端口写进 `webUI`（参考 `contract-check-mvp` 的写法）。

### 3.6 `webUI.*`

| 字段             | 必填                     | 约束                                                    |
| ---------------- | ------------------------ | ------------------------------------------------------- |
| `enabled`        | 必须（提供 `webUI` 时）  | boolean                                                 |
| `displayMode`    | 必须（提供 `webUI` 时）  | `external` / `proxy` / `embedded`                       |
| `startCommandId` | 可以                     | 必须是 `commands[]` 中某个 `id`；省略时取第一条 service |
| `stopCommandId`  | 可以                     | 同上；当前实现不使用                                    |
| `url`            | 可以                     | 字符串                                                  |
| `healthCheck`    | **要能被启动则必须提供** | 见下                                                    |

`healthCheck`：

| 字段             | 必填 | 约束                                         |
| ---------------- | ---- | -------------------------------------------- |
| `type`           | 必须 | **固定** `http`                              |
| `url`            | 必须 | HTTP 地址，支持平台变量（见 §5.7）           |
| `timeoutSeconds` | 可以 | 整数 ≥ 1，**健康检查总宽限期**（秒）；默认 5 |

**要能被启动并进入 `RUNNING`，就必须提供 `healthCheck`**——没有健康检查时，服务启动后直接进入 `RUNNING`，工作台不会去确认它是否真的可用。

**推荐写法**（端口用平台变量，不要写死）：

```json
"webUI": {
  "enabled": true,
  "displayMode": "proxy",
  "startCommandId": "start",
  "healthCheck": { "type": "http", "url": "http://127.0.0.1:${port}/", "timeoutSeconds": 30 }
}
```

### 3.7 `commands[]`（必须——当需要启动服务时）

数组，每项：

| 字段             | 必填 | 约束                                                     |
| ---------------- | ---- | -------------------------------------------------------- |
| `id`             | 必须 | 非空字符串，数组内唯一；被 `startCommandId` 引用         |
| `type`           | 必须 | `service`（常驻服务） / `job`（一次性作业）              |
| `executable`     | 必须 | **具体程序名或受控根内的绝对路径**，且在白名单内（§5.1） |
| `arguments`      | 可以 | 字符串数组；**不得**含端口字面量（§5.3）                 |
| `cwd`            | 可以 | 默认 `${project.root}`；相对路径相对项目根解析           |
| `timeoutSeconds` | 可以 | 整数 ≥ 0；`job` 用                                       |
| `concurrency`    | 可以 | `singleton` / `parallel`；**常驻服务应当写 `singleton`** |

**必须**至少提供一条 `type: "service"` 的命令，否则启动会失败（`COMMAND_NOT_REGISTERED`）。

`concurrency: singleton` 的语义：同项目 + 同命令已有**非终态**实例时，再次启动会被拒绝（`409 RUN_STATE_CONFLICT`），防止重复点击拉起第二个常驻进程、白占一个端口。

### 3.8 `models` / `memory`（可选，声明性）

| 字段                        | 必填（提供时） | 说明                        |
| --------------------------- | -------------- | --------------------------- |
| `models.defaultProfileId`   | 必须           | 默认模型 Profile ID         |
| `models.allowedProfileIds`  | 可以           | 允许的 Profile ID 数组      |
| `memory.defaultScope`       | 必须           | 默认记忆作用域              |
| `memory.crossProjectRecall` | 可以           | 是否允许跨项目召回，boolean |

这两个区块**可以**声明，但不参与登记校验之外的行为，也不影响启动；当前实现不影响项目能否跑起来。

### 3.9 不得出现的字段

以下写法**不得**出现，否则 `422 MANIFEST_INVALID`：

- 任何未在 §3.2～§3.8 列出的字段（含拼写错误、多写的 `port`、`healthCheck` 放错层级等）；
- 空对象 `{}` 或空字符串作为「占位符」——**未使用的区块直接不写**，不要写空值；
- `null` 值。

---

## 4. 项目侧运行约定（必须）

> **这一节是「登记成功但启动失败」的最主要原因。** 很多人只改了 manifest，没改项目代码。

### R1 必须从环境变量读端口

工作台通过**环境变量**把分配给本次启动的端口注入进程，变量名取自 `runtime.port.environmentVariable`。

- **必须**让服务监听在 `process.env.<ENV_VAR>`（Node）/ `os.environ["<ENV_VAR>"]`（Python）等**运行时可读**的位置。
- 该变量**必须**在 `runtime.port.environmentVariable` 中声明，否则工作台不知道往哪个变量写端口。
- **不得**把端口写死在代码里（会与其他项目、或与分配到的端口冲突）。
- 若确实无法读环境变量：把 `from` 与 `to` 设为**同一个值**（该端口即为你写死的端口），见 §3.5。

示例（Node，零依赖）：

```js
import { createServer } from 'node:http';
const PORT = Number(process.env.PORT ?? 0); // ← runtime.port.environmentVariable = "PORT"
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<h1>我的应用</h1>');
});
server.listen(PORT, '127.0.0.1', () => console.log(`listening on ${PORT}`));
```

### R2 必须提供 HTTP 健康端点

`webUI.healthCheck.url` 指向的地址**必须**在服务可对外服务时返回 **HTTP 2xx**。

- 返回 **200**（或任意 2xx）即视为健康；**4xx / 5xx 视为失败**（实现判断的是 `res.ok`）。
- 端点**应当**轻量：只检查进程自身可用性，**不得**依赖外部网络、数据库重连等可能拖慢响应的操作。
- 端点可以直接复用一个静态页（如 `/`），**可以**独立为 `/health`。
- `healthCheck.url` **必须**与 `runtime.port` 的实际监听地址一致：**推荐**写 `http://127.0.0.1:${port}/`，让工作台在运行时把 `${port}` 替换成真实端口。

### R3 必须只监听 127.0.0.1（IPv4 回环）

这是安全红线（26 SPEC §16 SEC-001），也是可用性要求。

- **必须**绑定 `127.0.0.1`，**不得**绑定 `0.0.0.0`。
- **不得**只绑定 IPv6 回环 `::1`。端口可用性探测与健康检查都走 `127.0.0.1`（IPv4）；只监听 `::1` 时分配器会认为端口空闲，而健康检查连不上，结果停在 `UNHEALTHY`。
- 前端 dev server（vite / next 等）**必须**显式指定 host 为 `127.0.0.1`——很多工具默认绑 `::1`。

### R4 必须在启动宽限期内进入可服务状态

健康检查会在 `timeoutSeconds` 声明的**总宽限期**内反复重试（默认 5 秒）。

- 含义：从进程启动到**开始返回 2xx**，可用时间就是 `timeoutSeconds`；未声明时为 5 秒。**建议**按项目真实冷启动时长声明（如 `timeoutSeconds: 30`）。
- 因此：**应当**在 `timeoutSeconds` 内完成监听并响应健康端点；冷启动慢的项目直接把该值调大即可，**不必**再把启动压到 2 秒内。
- 仍然推荐的解耦做法（Python 框架冷启动、首次编译等）：把「打开端口并响应健康端点」与「加载业务依赖」分离——先监听、健康端点先返回 200，再在后台继续初始化；或让健康端点直接返回静态 200 而不等业务就绪。
- 窗口耗尽仍未返回 2xx → 判 `UNHEALTHY`，**进程与端口会被立即回收**（可直接再次启动，无需先「停止」）。

> 历史上该值是固定的约 2 秒（`10 次 × 200ms`），`timeoutSeconds` 只控单次请求超时——该行为已于 2026-10-07 修复（RT-03），原已知限制 #19 已闭合。

### R5 Web UI 必须挂在根路径 `/`

工作台的「打开项目 Web UI」按 `http://127.0.0.1:<分配端口>` 打开，**不拼接子路径**。

- **必须**保证根路径 `/` 可直接打开可用的页面。
- 若应用的页面实际在子路径（如 `/app`），**应当**在根路径做重定向。

### R6 启动命令必须前台常驻

- `type: "service"` 的命令**必须**是**前台常驻**进程：不得自行 fork/daemonize 后立刻退出。
- **不得**在命令里内置 `&`、`nohup`、`start /b` 等后台化手段——工作台以子进程形式管理它，进程退出即认为服务结束。
- **不得**在成功启动后自动打开浏览器或弹出窗口。

### R7 端口段必须独占

见 §3.5：**不得**与已登记项目的端口段重叠。建议在登记清单里维护一张「段位分配表」，新项目取下一个空闲小段。

### R8 项目自身依赖必须先装好

登记（写库）不依赖项目依赖，但**启动**依赖：

- Node 项目**必须**先 `pnpm install` / `npm install`；
- Python 项目**必须**先建好虚拟环境并装依赖；
- **必须**在 manifest 里用**能解析到该环境**的 `executable`（例如项目自带 venv 的绝对路径 `C:/Projects/xxx/.venv/Scripts/python.exe`，而不是裸 `python`）。

### 反例：登记通过但启动失败

| 现象                            | 常见原因                                                | 对应条款  |
| ------------------------------- | ------------------------------------------------------- | --------- |
| 停在 `UNHEALTHY`                | 只监听 `::1`；健康端点非 2xx；启动超过 `timeoutSeconds` | R2 R3 R4  |
| 服务起来但「打开 Web UI」打不开 | 页面不在根路径；只绑 IPv6；服务其实已退出               | R3 R5     |
| 端口不对 / 服务起在别的端口     | 端口写死在代码里，没读环境变量                          | R1 §5.3   |
| `PORT_UNAVAILABLE`              | 端口段太窄或被其他项目/进程占用                         | §3.5 R7   |
| `COMMAND_NOT_REGISTERED`        | 没有 `service` 命令；或 `executable` 不在白名单         | §3.7 §5.1 |
| 进程立刻退出                    | 命令 daemonize 了；`cwd` 不对找不到入口文件             | R6 §5.4   |

---

## 5. 命令与安全约束（必须）

### 5.1 可执行程序白名单

`executable` 只允许以下程序（按 basename 比较、忽略大小写、忽略 `.exe`）：

```text
node  npm  npx  pnpm  python  python3  powershell  pwsh
```

另外**允许**「受控根内的绝对路径」（项目自带的二进制，如 `C:/Projects/xxx/.venv/Scripts/python.exe`）。

- **不得**使用 `cmd` / `bash` / `sh` / `zsh` 等 shell。
- 需要白名单外的程序（如 `uv`、`docker`、`deno`）时，**必须**由工作台侧通过环境变量 `WB_ALLOWED_EXECUTABLES`（逗号分隔）扩展——**不得**改工作台代码来绕过。

### 5.2 参数约束

`arguments` 只能是**静态值**或**平台变量**（§5.7）。

**不得**出现：

- `shell: true` 或任何等价的 shell 解释；
- 管道 `|`、重定向 `>` `<` `2>&1`、串联 `&&` `||` `;`；
- 命令拼接、命令替换（`$( )`、反引号）；
- 未解析的 glob（`*.js`、`**/*.ts`）。

### 5.3 端口不得写进 `arguments`（重要）

命令参数解析时，平台变量 `${port}` **会被替换成字面量 `0`**——因为参数在分配端口**之前**解析。真实端口随后才通过**环境变量**注入。

- 因此 `"arguments": ["server.mjs", "--port", "${port}"]` 是**错的**，会变成 `--port 0`。
- **必须**走 §4.1：服务从环境变量读端口。
- 唯一例外：`webUI.healthCheck.url` 里的 `${port}`（那是**运行时**替换，安全）。

### 5.4 `cwd`

- 未声明时默认 `${project.root}`。
- 相对路径**相对项目根**解析；**应当**用相对路径（如 `scripts`）而不是绝对路径，避免换机器后失效。
- `cwd` 解析后**必须**仍在受控根内，否则被拒绝。

### 5.5 `concurrency`

- `service` 类型**应当**声明 `singleton`（默认不限制，容易误拉起多份）。
- `job` 类型**可以**用 `parallel`；若作业会写同一份输出文件，**应当**用 `singleton`。

### 5.6 Secret

- **不得**把密钥、Token、口令以任何形式写进 manifest、`arguments`、环境变量字面量、源码、日志。
- **必须**通过工作台凭据存储（`credentialRef`）或受控环境映射注入。

### 5.7 平台变量

`arguments` / `cwd` / `healthCheck.url` 中支持：

| 变量              | 含义                   | 可用位置                 |
| ----------------- | ---------------------- | ------------------------ |
| `${project.root}` | 项目受控根（绝对路径） | `arguments` / `cwd`      |
| `${port}`         | 本次分配的动态端口     | **仅** `healthCheck.url` |
| `${runtime.port}` | 同上（别名）           | **仅** `healthCheck.url` |

> 记忆点：**端口进参数=0，端口进 healthCheck=真端口。**

---

## 6. 登记后的运行语义（应当知悉）

| 事项                  | 语义                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 进入 `RUNNING` 的条件 | 声明了 `healthCheck` 时，**必须**健康检查通过；未声明则启动即 `RUNNING`                                                                                                                                                                                                               |
| 健康检查失败          | 状态置 `UNHEALTHY`，**进程与端口会被立即回收**（可直接重新登记后再次启动）                                                                                                                                                                                                            |
| 失败后想重启          | **可直接再次启动**——`UNHEALTHY` 实例不阻塞重启，也不会再返回 `409 RUN_STATE_CONFLICT`                                                                                                                                                                                                 |
| 停止                  | 只作用于该次启动记录的进程树，不会按端口或进程名批量杀进程                                                                                                                                                                                                                            |
| 停止是**同步**的      | 停止 API 会等到进程真正退出、端口释放后才返回 `STOPPED`，因此**停止后可立即再次启动**，不存在异步等待窗口（历史行为见已知限制 #20，已于 2026-10-07 修复）                                                                                                                             |
| 查询运行状态          | `GET /api/v1/projects/{projectId}/runtime` 返回服务端真实状态；**未启动**返回 `STOPPED` 空态（`port`/`pid` 为 0）而非 404，未知项目才 404。前端「项目」页在选中与切回时会查询，非终态每 1.5 秒轮询至收敛                                                                              |
| 移除登记              | **只注销登记，不删除磁盘上的项目目录与产物**；移除前会把 manifest 快照留档                                                                                                                                                                                                            |
| 修改 manifest         | **没有 update 端点**——只能「移除登记 → 重新登记」                                                                                                                                                                                                                                     |
| 项目运行中移除登记    | 默认拒绝（`409`）；需显式「停止服务并移除」                                                                                                                                                                                                                                           |
| 命令的运行环境        | 项目进程**继承宿主工作台的环境变量与 `PATH`**（`packages/project-runtime/src/process-executor.ts:38` 在 `process.env` 上叠加注入项）。因此声明 `executable: "node"` 拿到的**是宿主 PATH 上那个 Node**，而不是「你本机默认版本」—— 宿主工作台锁定 Node 22，命令里的 `node` 通常就是 22 |

---

## 7. 提交登记

### 7.1 三种入口（本质同一）

| 入口     | 形态                                     | 说明                                    |
| -------- | ---------------------------------------- | --------------------------------------- |
| Web UI   | 侧栏「登记新项目」→ **表单模式**（推荐） | 填 id / name / root / 端口段 / 启动命令 |
| Web UI   | 侧栏「登记新项目」→ **JSON 模式**        | 直接粘贴完整 manifest                   |
| 命令行   | `node scripts/register-projects.mjs`     | 读登记清单，逐条提交；支持 `--dry-run`  |
| REST API | `POST /api/v1/projects/register`         | 只吃完整 manifest                       |

三者都调用同一个端点，**没有任何捷径绕过 Schema 校验**。

### 7.2 登记根

登记根由工作台侧环境变量 `WB_PROJECTS_ROOT` 指定；`runtime.root` 解析后**必须**落在其中。

- **未设置 `WB_PROJECTS_ROOT` 时不限制**（向后兼容）。要让「越界即 403」生效，**必须**在启动工作台时显式设置。
- 越界返回 `403 PATH_OUTSIDE_ROOT`。

### 7.3 错误码 → 处置映射表

| 错误码                     | HTTP | 含义                | 项目方该做什么                                        |
| -------------------------- | ---- | ------------------- | ----------------------------------------------------- |
| `MANIFEST_INVALID`         | 422  | 不符合 Schema       | 看返回的 `issues` 逐条改：多余字段、拼错键、id 不合法 |
| `PATH_OUTSIDE_ROOT`        | 403  | `runtime.root` 越界 | 确认 root 在登记根内、且用正斜杠绝对路径              |
| `PROJECT_ALREADY_EXISTS`   | 409  | id 或 root 已被占用 | 换 id；或先移除旧登记再重新登记                       |
| `COMMAND_NOT_REGISTERED`   | 404  | 命令/程序不可用     | 补 `service` 命令；或程序不在白名单（§5.1）           |
| `COMMAND_ARGUMENT_INVALID` | 422  | 参数不符合 Schema   | 检查 `arguments` 是否含 shell 语法（§5.2）            |
| `PORT_UNAVAILABLE`         | 409  | 端口段内无可用端口  | 换一个不与既有项目重叠的端口段（§3.5 / R7）           |
| `HEALTH_CHECK_FAILED`      | 503  | 健康检查未通过      | 按 §4 的 R2 / R3 / R4 逐条排查                        |
| `RUN_STATE_CONFLICT`       | 409  | 状态不允许该操作    | 已有运行中实例：先停止；或移除登记                    |
| `PROJECT_NOT_FOUND`        | 404  | 项目/服务不存在     | 确认已登记、且服务处于非终态                          |

---

## 8. 接口现状边界（诚实声明）

以下能力**当前未实现**，**不得**据此认为项目或工作台已具备相应行为：

| 能力                      | 当前真相                                                                                                                                                                                                         | 对项目方的影响                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webUI.displayMode`       | **仅登记、不生效**：实现无代理路由，「打开项目 Web UI」直接跳 `127.0.0.1:<端口>`                                                                                                                                 | 可以照常声明；但不要在项目侧依赖「被代理 / 被内嵌」的假设                                                                                                         |
| `webUI.url`               | **不参与地址构造**，是声明性字段                                                                                                                                                                                 | 地址由分配的端口决定；`healthCheck.url` 才是生效的那个                                                                                                            |
| `webUI.stopCommandId`     | 引用被存储，但停止走统一机制                                                                                                                                                                                     | 可以声明；不必为停止单独写脚本                                                                                                                                    |
| `models` / `memory`       | 有存储与网关，**不影响**登记与启动                                                                                                                                                                               | 可以声明；不要靠它来启动服务                                                                                                                                      |
| 扫描目录自动登记          | **无此能力**（刻意的安全取舍）                                                                                                                                                                                   | manifest 必须由你产出并提交                                                                                                                                       |
| 更新已登记项目            | **无 update 端点**                                                                                                                                                                                               | 改 manifest 必须「移除登记 → 重新登记」                                                                                                                           |
| 项目自带 manifest 文件    | `<root>/.workbench/project.yaml` **当前不被读取**                                                                                                                                                                | manifest 请提交给登记入口，不要只放在项目里                                                                                                                       |
| 健康检查总宽限期          | 等于 `timeoutSeconds`（默认 5 秒），窗口内持续重试                                                                                                                                                               | 见 R4：按真实冷启动时长声明即可                                                                                                                                   |
| 目录唯一性                | **字符串比较**                                                                                                                                                                                                   | 同一目录只有一种写法，统一用正斜杠绝对路径                                                                                                                        |
| README 简介（PROJ-UI-01） | **规范外扩展端点** `GET /api/v1/projects/:id/readme`：只读登记根**顶层**的 `README.md / readme.md / Readme.md / README.markdown / readme.markdown / README.txt / readme.txt`，256 KB 截断，`?probe=1` 只回元信息 | 想在工作台「简介」页签展示自述，把 `README.md` 放在**登记根顶层**；子目录里的不会被读取。manifest 的 `project.description` 会作为卡片简介回显（没有则显示根目录） |

---

## 9. 对接自检清单

### 9.1 提交登记前

- [ ] `project.id` 满足 `^[a-z][a-z0-9-]{2,63}$`，且未与既有项目重复
- [ ] `runtime.root` 是**正斜杠绝对路径**（如 `C:/Projects/my-app`），在登记根内
- [ ] `runtime.port` 是与既有项目**不重叠**的专属小段，且 `from ≤ to`
- [ ] `runtime.port.environmentVariable` 已声明，且项目代码确实读这个变量
- [ ] 至少一条 `type: "service"` 命令，`executable` 在白名单内
- [ ] 命令**没有**把端口写进 `arguments`（§5.3）
- [ ] 命令**没有** shell 语法（管道 / 重定向 / `&&` / 拼接 / glob）
- [ ] `webUI.healthCheck.url` 用 `${port}`，且指向**根路径或 `/health`**
- [ ] **没有任何** Schema 之外的字段（第 3.2～3.8 节之外的一律删掉）
- [ ] 项目侧依赖已装好（`node_modules` / venv）

### 9.2 启动后

- [ ] 状态变成 **`RUNNING`**（不是 `UNHEALTHY`）
- [ ] `timeoutSeconds` 已按**真实冷启动时长**声明（不要留默认 5 秒给慢启动项目）
- [ ] 「打开项目 Web UI」能打开页面（根路径可用）；该按钮仅在 `RUNNING` 时可点
- [ ] 服务只监听 **`127.0.0.1`**（不是 `0.0.0.0`、不是 `::1`）
- [ ] 健康端点手工访问返回 **2xx**
- [ ] 运行中重复点「启动」得到 `409 RUN_STATE_CONFLICT`（说明 `singleton` 生效，符合预期）
- [ ] 「停止服务」后状态收敛为 `STOPPED`，进程真的结束、端口被释放
- [ ] 停止后**立即再次启动**能成功（不再报「已有运行中的实例」）
- [ ] 切到其它页面再回到「项目」，显示的状态与服务端真实状态一致

---

## 10. 参考样例与模板

### 10.1 直接可用的模板

- [templates/project/manifest.example.json](../templates/project/manifest.example.json) —— 最小可用完整样例
- [templates/project/README.md](../templates/project/README.md) —— 怎么复制、改哪几处、怎么提交

### 10.2 六种真实形态（均已登记并验证）

| 技术栈                    | 端口注入变量            | `executable`                 | 关键点                          |
| ------------------------- | ----------------------- | ---------------------------- | ------------------------------- |
| Node 内置模块静态服务     | `PORT`                  | `node`                       | 零依赖，最简形态                |
| Next.js（pnpm workspace） | `PORT`                  | `pnpm`                       | 参数 `["--filter","web","dev"]` |
| Streamlit                 | `STREAMLIT_SERVER_PORT` | `python`                     | 环境变量名非 `PORT`             |
| NiceGUI                   | `APP_PORT`              | 项目 venv 内 python 绝对路径 | 用自带解释器                    |
| Python 固定端口 CLI       | 无（`from == to`）      | `python`                     | 端口写死时收窄为单端口          |
| PowerShell 工具（无常驻） | 无                      | `powershell`                 | 只有 `job`，不提供 `webUI`      |

完整清单见 [scripts/projects.registry.json](../scripts/projects.registry.json)。

---

## 附录 A：字段参考（依 `schemas/project.schema.json`）

```text
schemaVersion            string  const "workbench.project/v1"                      [必填]
project                  object                                                   [必填]
  ├─ id                  string  pattern ^[a-z][a-z0-9-]{2,63}$                    [必填]
  ├─ name                string  minLength 1                                       [必填]
  └─ description         string                                                    [可选]
runtime                  object                                                   [必填]
  ├─ root                string                                                    [必填]
  └─ port                object                                                    [可选]
      ├─ strategy        string  const "dynamic"                                   [必填]
      ├─ from            integer 1..65535                                          [必填]
      ├─ to              integer 1..65535                                          [必填]
      └─ environmentVariable  string                                               [可选]
webUI                    object                                                   [可选]
  ├─ enabled             boolean                                                   [必填]
  ├─ displayMode         enum external | proxy | embedded                          [必填]
  ├─ startCommandId      string                                                    [可选]
  ├─ stopCommandId       string                                                    [可选]
  ├─ url                 string                                                    [可选]
  └─ healthCheck         object                                                    [可选]
      ├─ type            string  const "http"                                      [必填]
      ├─ url             string                                                    [必填]
      └─ timeoutSeconds  integer >= 1                                              [可选]
commands                 array<object>                                            [可选]
  └─ item
      ├─ id              string  minLength 1                                       [必填]
      ├─ type            enum service | job                                        [必填]
      ├─ executable      string  minLength 1                                       [必填]
      ├─ arguments       array<string>                                             [可选]
      ├─ cwd             string                                                    [可选]
      ├─ timeoutSeconds  integer >= 0                                              [可选]
      └─ concurrency     enum singleton | parallel                                 [可选]
models                   object                                                   [可选]
  ├─ defaultProfileId    string                                                    [必填]
  └─ allowedProfileIds   array<string>                                             [可选]
memory                   object                                                   [可选]
  ├─ defaultScope        string                                                    [必填]
  └─ crossProjectRecall  boolean                                                   [可选]

所有层级 additionalProperties: false —— 多余字段一律 422。
```

## 附录 B：「必须」条款与实现落点对照

| 条款                                                  | 工作台侧落点                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| §3.2 顶层必填 3 项 / 各层 `required`                  | `schemas/project.schema.json:7,15,33`                                                 |
| §3.2 不允许多余字段                                   | `schemas/project.schema.json`（各层 `additionalProperties: false`）                   |
| §3.3 id 正则                                          | `schemas/project.schema.json:20`                                                      |
| §3.4 root 落在登记根内                                | `packages/project-runtime/src/project-catalog.ts:104`                                 |
| §3.4 root 唯一（字符串比较）                          | `packages/project-runtime/src/project-catalog.ts:117`                                 |
| §3.3 id 唯一                                          | `packages/project-runtime/src/project-catalog.ts:112`                                 |
| §3.5 端口段顺序分配 / 耗尽报错                        | `packages/project-runtime/src/port-allocator.ts`                                      |
| §3.5 缺省端口段 8100–8199                             | `apps/server/src/routes/runtime.ts:57`                                                |
| §3.6 `startCommandId` 缺省取首条 service              | `apps/server/src/routes/runtime.ts:28-30`                                             |
| §4.1 端口经环境变量注入                               | `packages/project-runtime/src/service-manager.ts:49`                                  |
| §4.2 健康端点须返回 2xx                               | `packages/project-runtime/src/health-check.ts:2-12`                                   |
| §4.3 端口探测绑 127.0.0.1                             | `packages/project-runtime/src/port-allocator.ts:4-13`                                 |
| §4.4 健康检查总窗口 = `timeoutSeconds`                | `packages/project-runtime/src/health-check.ts`（窗口耗尽前持续重试）                  |
| §5.1 可执行白名单                                     | `packages/project-runtime/src/executable-policy.ts:10-19,50-83`                       |
| §5.2 禁 shell / 管道 / 重定向                         | 26 SPEC §5；`executable-policy.ts` 注释（白名单刻意不含 shell）                       |
| §5.3 端口在参数中被替换为 0                           | `apps/server/src/routes/runtime.ts:60`（`port: 0`）+ `:64`                            |
| §5.4 `cwd` 默认项目根                                 | `packages/project-runtime/src/runtime-vars.ts:31-43`                                  |
| §5.7 平台变量                                         | `packages/project-runtime/src/runtime-vars.ts:20-26`                                  |
| §6 健康检查通过才 RUNNING                             | `packages/project-runtime/src/service-manager.ts`                                     |
| §6 失败置 UNHEALTHY 并回收进程与端口                  | `packages/project-runtime/src/service-manager.ts`（健康检查失败分支）                 |
| §6 `singleton` 阻塞重复启动（UNHEALTHY 除外）         | `apps/server/src/routes/runtime.ts`（start 的 singleton 判定）                        |
| §6 停止等待进程真退 + 端口释放                        | `packages/project-runtime/src/service-manager.ts`（stop 等待终态）                    |
| §6 `GET /runtime` 查询真实状态                        | `apps/server/src/routes/runtime.ts`；前端 `apps/web/src/App.tsx`（选中/切回 + 轮询）  |
| §7.1 唯一写入口                                       | `apps/server/src/routes/projects.ts:63`                                               |
| §7.2 登记根 `WB_PROJECTS_ROOT`                        | `apps/server/src/app.ts:101`；`packages/project-runtime/src/project-catalog.ts:40-52` |
| §7.3 错误码表                                         | 26 SPEC §17                                                                           |
| §8 「打开 Web UI」按端口构造地址，且仅 `RUNNING` 可点 | `apps/web/src/App.tsx`（按钮 disabled 条件 + `title` 说明）                           |

## 附录 C：相关文档

- [用户手册](./user-manual.md) —— 界面上的逐步操作
- [公开登记示例](../scripts/projects.registry.example.json) —— CLI 清单方式与已知限制
- [项目模板说明](../templates/project/README.md) —— 为什么必须 manifest
- [已知限制](./issues/known-limitations.md)
- [用户手册](./user-manual.md) · [开发手册](./developer-guide.md)
