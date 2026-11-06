# Windows 安装、升级、卸载与数据保留

本文档描述个人 AI 全局工作台在 Windows 上的安装、升级、卸载流程，以及数据保留策略。

> **运行前置：Node 22.x（必须）+ pnpm 10。** 仓库锁定 Node 22（`.nvmrc`；`engines.node` = `>=22 <23`）。SQLite 驱动 `better-sqlite3` 是**原生模块**，二进制按 Node ABI 编译绑定，用 Node 23/24 会在**打开数据库**时报 `ERR_DLOPEN_FAILED`。`pnpm start` 与双击 `start.cmd` 均会在构建前校验并拦截。
>
> **双击 `start.cmd` 时若 PATH 上的 `node` 不是 22**，启动器会自动在 `WB_NODE_HOME`、nvm-windows、fnm、asdf、Volta、并排安装目录与用户级工具链里查找 Node 22，命中则**只为本次会话**前置到 PATH 并打印选中目录；装在别处可 `set WB_NODE_HOME=<该目录>` 后重试。
>
> 强行跳过用 `WB_ALLOW_NODE_MISMATCH=1`（**只跳过检查，不修 ABI 不匹配，仍会失败**）。**升级 Node 版本后必须重新 `pnpm install`。**

## 1. 目录约定

| 目录     | 说明                                          | 默认路径                                    |
| -------- | --------------------------------------------- | ------------------------------------------- |
| 程序目录 | 工作台代码与依赖                              | `%LOCALAPPDATA%\personal-ai-workbench`      |
| 数据目录 | SQLite / Artifact / 扩展 / 备份 / Memory 导出 | `%LOCALAPPDATA%\personal-ai-workbench-data` |

数据目录与程序目录**分离**：卸载程序不会删除数据；只有显式 `-Purge` 才删除数据。

## 2. 数据目录内容

```
personal-ai-workbench-data/
├── workbench.db        # SQLite（migration 自动升级）
├── artifacts/          # Artifact 内容
├── extensions/         # 已安装扩展
├── backups/            # 备份（含升级前备份）
└── .workbench-data     # 数据目录定位标记
```

运行时通过环境变量定位数据：

| 环境变量       | 含义        | 默认                          |
| -------------- | ----------- | ----------------------------- |
| `WB_DATA_DIR`  | 数据根目录  | `var`                         |
| `WB_DB`        | 数据库路径  | `${WB_DATA_DIR}/workbench.db` |
| `WB_ARTIFACTS` | Artifact 根 | `${WB_DATA_DIR}/artifacts`    |

## 3. 安装

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/install.ps1 `
  -TargetDir "$env:LOCALAPPDATA\personal-ai-workbench" `
  -DataDir "$env:LOCALAPPDATA\personal-ai-workbench-data"
```

安装脚本初始化数据目录子目录（artifacts / extensions / backups），写入 `.workbench-data` 标记。程序目录已存在时按升级处理（保留）。

## 4. 升级

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/upgrade.ps1 `
  -DataDir "$env:LOCALAPPDATA\personal-ai-workbench-data"
```

升级脚本在替换程序前把 `workbench.db` / `artifacts` / `extensions` 备份到 `backups/pre-upgrade-<时间戳>/`。新版本程序首次启动时按单向、事务化 migration 自动升级 schema，**数据保留**。

## 5. 卸载

```powershell
# 卸载程序，保留数据
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/uninstall.ps1 `
  -TargetDir "$env:LOCALAPPDATA\personal-ai-workbench" `
  -DataDir "$env:LOCALAPPDATA\personal-ai-workbench-data"

# 卸载程序并删除数据
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/uninstall.ps1 -Purge ...
```

## 6. 数据保留策略

- 卸载默认**保留数据目录**（SQLite、Artifact、扩展、备份）。
- 升级**自动备份**后替换程序，数据保留。
- 数据库升级由单向 migration 保证可重复启动（失败回滚该 migration）。
- 凭据（Credential）存于 Windows Credential Manager，不在数据目录内。

## 7. 版本信息

运行中的工作台可查询 `GET /api/v1/app-info` 获取版本与数据目录路径。
