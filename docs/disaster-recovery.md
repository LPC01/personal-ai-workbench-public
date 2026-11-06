# 灾难恢复手册（Disaster Recovery）

本文档描述个人 AI 全局工作台的备份与恢复流程，满足 26 SPEC §20 的要求：备份包含 SQLite 一致性快照、Manifest、已安装扩展包、Artifact 索引、Memory 导出和配置；不包含明文 Credential；恢复必须先校验哈希，在临时目录验证后原子切换。

## 1. 目标

| 指标                | 值                                                                |
| ------------------- | ----------------------------------------------------------------- |
| RPO（恢复点目标）   | 最近一次备份（建议每个里程碑 / 每日一次）                         |
| RTO（恢复时间目标） | 分钟级（备份包为单机本地文件，恢复为原子文件切换）                |
| 备份范围            | SQLite 全库 + Manifest + 扩展索引 + Artifact 索引 + Memory + 配置 |
| 排除项              | 明文 Credential（凭据存于 Credential Manager，不落备份）          |

## 2. 备份内容

一个备份目录（`backupDir/`）包含以下文件：

| 文件                   | 内容                                                |
| ---------------------- | --------------------------------------------------- |
| `db.sqlite`            | SQLite 一致性快照（`VACUUM INTO` 生成，WAL 已合并） |
| `projects.json`        | 已注册项目 Manifest 列表                            |
| `extensions.json`      | 已安装扩展列表                                      |
| `artifacts.json`       | Artifact 索引（不含内容文件）                       |
| `memory.md`            | Memory 导出（Markdown 降级）                        |
| `config.json`          | 工作台配置（不含 Credential）                       |
| `backup-manifest.json` | 备份清单：每个文件的 SHA-256 + 大小 + 时间戳        |

## 3. 创建备份

> 下文示例按后端 `3000` 端口书写（直接运行 server 的缺省端口）。若用 `pnpm start` 启动，后端默认在 **`4000`**（见 [用户手册 §1](./user-manual.md#1-快速开始)），请把 URL 中的端口一并替换。

```bash
curl -X POST http://127.0.0.1:3000/api/v1/backup \
  -H "Content-Type: application/json" \
  -d '{"dir": "C:/Backups/workbench-example"}'
```

返回 `{ dir, manifest }`，其中 `manifest.files` 列出每个文件的 SHA-256。

## 4. 校验备份

```bash
curl "http://127.0.0.1:3000/api/v1/backup/verify?dir=C%3A%2FBackups%2Fworkbench-example"
```

返回 `{ ok, checked, mismatches }`。恢复前必须确认 `ok === true`。

## 5. 恢复演练

```bash
curl -X POST http://127.0.0.1:3000/api/v1/restore \
  -H "Content-Type: application/json" \
  -d '{"backupDir": "C:/Backups/workbench-example", "targetDbPath": "C:/Projects/workbench/var/workbench.db"}'
```

恢复流程（`RestoreService.restore`）：

1. **校验哈希**：逐文件比对 SHA-256，任一不匹配即拒绝（`BACKUP_INVALID` 422）。
2. **临时验证**：以只读方式打开快照，确认 `sqlite_master` 中表数量大于 0。
3. **原子切换**：先复制到 `targetDbPath.restore-<ts>.tmp`，再 `rename` 到目标路径（避免半写入）。

## 6. 演练记录

恢复演练应覆盖备份、恢复和恢复库完整性检查。实际备份及演练记录留在本地，不提交到源码仓库。

## 7. 注意事项

- 恢复会覆盖目标数据库文件，恢复前请自行留存现有文件。
- 凭据（Credential）不在备份内，恢复后需在设置页重新登记。
- Artifact 内容文件（`var/artifacts/`）不在索引内，如需完整恢复请另行复制该目录。
