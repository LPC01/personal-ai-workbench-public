# AGENTS.md

本文件适用于此公开源码快照。

## 工作约定

- 先检查工作区状态，保护已有修改。
- 以仓库内源码、JSON Schema、测试、ADR 和通用文档为依据，不依赖外部个人交付包。
- 保持 Node 22、TypeScript strict、React + Vite、Fastify、SQLite 和 pnpm workspace 技术基线。
- 依赖方向保持 apps → application packages → domain/contracts。
- 变更公共 API、Schema 或数据库结构时同步文档与测试。
- 命令执行保持登记、白名单和受控路径检查；模型产出必须通过确定性验证。
- 不将凭据、真实项目清单、数据库、会话、日志、截图或个人路径提交到仓库。
- 本地验证输出统一放在被忽略的 `var/verification/`。
- 测试里的通用 Windows/POSIX 路径和明确的安全测试字符串属于合成夹具，不代表真实部署信息。

## 检查命令

```bash
pnpm -r build
pnpm typecheck
pnpm -r typecheck
pnpm lint
pnpm format:check
pnpm test --maxWorkers=1
pnpm docs:check
```

根类型检查不覆盖全部子包。报告实际运行的检查及失败项，不以历史验收结果替代当前验证。
