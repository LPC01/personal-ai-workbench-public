# 项目对接模板

把本项目登记进个人 AI 全局工作台所需的**最小可用模板**。配套规范见
[`docs/project-integration-spec.md`](../../docs/project-integration-spec.md)——**规范是权威**，本文件只是它的可复制落地件。

## 文件

| 文件                    | 用途                                                    |
| ----------------------- | ------------------------------------------------------- |
| `manifest.example.json` | 可直接复制改用的 manifest（登记接口唯一接受的输入形态） |

## 三步用法

### 1. 复制并改 5 处

把 `manifest.example.json` 复制到任意位置（**不必**放进你的项目目录），改这 5 处即可：

| #   | 字段                                   | 改什么                                                    |
| --- | -------------------------------------- | --------------------------------------------------------- |
| 1   | `project.id`                           | 你的项目 id，小写字母开头，如 `my-app`                    |
| 2   | `project.name`                         | 界面上显示的名字                                          |
| 3   | `runtime.root`                         | **正斜杠绝对路径**，如 `C:/Projects/my-app`               |
| 4   | `runtime.port` 的 `from` / `to`        | 一段**未被其他项目占用**的端口，如 8160–8169              |
| 5   | `commands[0].executable` / `arguments` | 你的启动命令，如 `["-m","streamlit","run","app/main.py"]` |

另外按需改 `runtime.port.environmentVariable`（必须与**代码里读的那个变量名**一致）与
`webUI.healthCheck.url`。

### 2. 确认项目代码符合运行约定

这一步**不改**就会「登记成功但启动失败」。四个硬要求：

1. **从环境变量读端口**——代码里必须监听 `process.env.PORT`（或你声明的变量名），不能写死。
2. **提供 HTTP 健康端点**——`healthCheck.url` 指向的地址在可服务时返回 **2xx**。
3. **只监听 `127.0.0.1`**——不能绑 `0.0.0.0`，也不能只绑 IPv6 的 `::1`。
4. **在 `timeoutSeconds` 内开始响应**——健康检查会在你声明的宽限期内持续重试；冷启动慢就把 `healthCheck.timeoutSeconds` 调大（如 30），启动超时停在 `UNHEALTHY` 后进程会被回收、可直接再次启动。

细节与排错见规范 [§4 项目侧运行约定](../../docs/project-integration-spec.md#4-项目侧运行约定必须)。

### 3. 提交登记

Web UI → 侧栏「登记新项目」→ **JSON 模式**，粘贴改好的 manifest → 登记。
表单模式也可以（等价，无需手写 JSON）。

登记后回到「项目」视图 → 启动 → 状态应为 **`RUNNING`** → 「打开项目 Web UI」。

## 常见形态速查

| 你的项目             | `executable`                               | `arguments`                              | 端口变量                |
| -------------------- | ------------------------------------------ | ---------------------------------------- | ----------------------- |
| Node 静态服务        | `node`                                     | `["server.mjs"]`                         | `PORT`                  |
| Vite / Next dev      | `pnpm`                                     | `["--filter","web","dev"]`               | `PORT`                  |
| Streamlit            | `python`                                   | `["-m","streamlit","run","app/main.py"]` | `STREAMLIT_SERVER_PORT` |
| NiceGUI              | `C:/Projects/xxx/.venv/Scripts/python.exe` | `["-m","workbench.app"]`                 | `APP_PORT`              |
| 固定端口 CLI         | `python`                                   | `["main.py","serve"]`                    | 省略，`from == to`      |
| 无常驻 Web UI 的工具 | `powershell`                               | `["-NoProfile","-File","doctor.ps1"]`    | 省略                    |

## 三个最容易踩的坑

1. **端口不能写进 `arguments`。** `${port}` 在参数里会被替换成字面量 `0`（参数在分配端口前解析）。
   端口只能经环境变量注入。唯一例外是 `webUI.healthCheck.url` 里的 `${port}`，那是运行时替换。
2. **路径只有一种写法。** 目录唯一性是字符串比较，`C:\Projects\x` 与 `C:/Projects/x` 会被当成两个目录；
   统一用正斜杠绝对路径。
3. **多余字段直接 422。** Schema 是 `additionalProperties: false`，不要凭直觉加字段。

## 提交前自检

逐条过规范 [§9 对接自检清单](../../docs/project-integration-spec.md#9-对接自检清单)。
