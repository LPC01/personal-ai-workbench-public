# 个人 AI 全局工作台

本地优先的个人 AI 工作系统：统一管理项目、助手、工作流、模型与多智能体会话。

这是 v0.2.0 的公开源码快照，包含 Web 前端、本地 HTTP 服务、共享包、测试和通用文档。

## 环境要求

- Node.js 22.x；具体版本见 `.nvmrc`。原生 SQLite 模块需要与安装时的 Node ABI 一致。
- pnpm 10.33.4；依赖版本固定在 `pnpm-lock.yaml`。
- Windows 支持一键启动；其他平台的可用性取决于各适配器，见已知限制。

## 安装与启动

```bash
pnpm install --frozen-lockfile
pnpm start
```

Windows 也可以双击 `start.cmd`。默认后端为 `http://127.0.0.1:4000`，前端为 `http://127.0.0.1:5173`。
启动器会先构建后端及依赖，再启动两个服务；按 Ctrl+C 结束。

常用环境变量：`WB_PORT`、`WB_WEB_PORT`、`WB_DATA_DIR`、`WB_PROJECTS_ROOT`、`WB_NODE_HOME`。
运行数据默认写入被 Git 忽略的 `var/`。模型服务及凭据需要自行配置。

## 登记项目

`scripts/projects.registry.json` 默认为空数组，不预置任何本机项目。
参考 `scripts/projects.registry.example.json` 或 `templates/project/manifest.example.json`，
填写自己的路径后，通过工作台界面或批量脚本登记：

```bash
node scripts/register-projects.mjs --file scripts/projects.registry.local.json --dry-run
node scripts/register-projects.mjs --file scripts/projects.registry.local.json
```

本地清单匹配 `*.local.json` 忽略规则，不应提交。示例中的 `C:/Projects` 是虚构目录，需要按实际环境替换。
完整规则见 [项目对接规范](docs/project-integration-spec.md)。

## 开发检查

```bash
pnpm -r build
pnpm typecheck
pnpm -r typecheck
pnpm lint
pnpm format:check
pnpm test --maxWorkers=1
pnpm docs:check
```

根类型检查不会自动覆盖所有子包，因此需要额外运行递归类型检查。
浏览器冒烟脚本需要可用的 `playwright-core` 和 Edge；通过 `PLAYWRIGHT_CORE` 可指定模块位置。
浏览器冒烟生成的日志与截图位于 `var/verification/`。

## 目录

```text
apps/web/                 React + Vite 前端
apps/server/              Fastify 本地服务
packages/                 契约、领域逻辑、存储、执行、模型与记忆网关
schemas/                  JSON Schema
templates/                通用项目和扩展模板
tests/                    契约、集成与测试夹具
scripts/                  启动、登记和冒烟脚本
docs/                     通用使用与开发文档
```

## 文档

- [用户手册](docs/user-manual.md)
- [开发手册](docs/developer-guide.md)
- [Windows 安装](docs/windows-install.md)
- [备份与恢复](docs/disaster-recovery.md)
- [已知限制](docs/issues/known-limitations.md)
- [公开源码边界](docs/public-source.md)

原项目 README 声明的许可证为 MIT；本源码快照未新增或变更授权条款，也不包含原开发者身份信息。
