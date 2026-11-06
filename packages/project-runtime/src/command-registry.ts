import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ProjectCommand } from '@workbench/contracts';
import { AppError } from '@workbench/domain';

export interface RegisteredCommand {
  projectId: string;
  commandId: string;
  revision: number;
  definition: ProjectCommand;
  definitionHash: string;
  enabled: boolean;
}

interface CommandRow {
  project_id: string;
  command_id: string;
  revision: number;
  definition_json: string;
  definition_hash: string;
  enabled: number;
}

function mapCommand(row: CommandRow): RegisteredCommand {
  return {
    projectId: row.project_id,
    commandId: row.command_id,
    revision: row.revision,
    definition: JSON.parse(row.definition_json) as ProjectCommand,
    definitionHash: row.definition_hash,
    enabled: row.enabled === 1,
  };
}

/** Command Registry（26 SPEC §6.4）：命令版本化登记与查询。 */
export class CommandRegistry {
  constructor(private readonly db: Database.Database) {}

  /** 登记命令；定义哈希未变化时复用现有 revision，变化则新增 revision。 */
  registerCommands(projectId: string, commands: ProjectCommand[]): RegisteredCommand[] {
    const results: RegisteredCommand[] = [];
    for (const command of commands) {
      const definitionJson = JSON.stringify(command);
      const definitionHash = createHash('sha256').update(definitionJson).digest('hex');

      const latest = this.db
        .prepare(
          `SELECT revision, definition_hash FROM project_commands
           WHERE project_id = ? AND command_id = ? ORDER BY revision DESC LIMIT 1`,
        )
        .get(projectId, command.id) as { revision: number; definition_hash: string } | undefined;

      if (latest && latest.definition_hash === definitionHash) {
        results.push(this.getCommand(projectId, command.id) as RegisteredCommand);
        continue;
      }

      const revision = (latest?.revision ?? 0) + 1;
      this.db
        .prepare(
          `INSERT INTO project_commands (project_id, command_id, revision, definition_json, definition_hash, enabled)
           VALUES (?, ?, ?, ?, ?, 1)`,
        )
        .run(projectId, command.id, revision, definitionJson, definitionHash);

      results.push(this.getCommand(projectId, command.id) as RegisteredCommand);
    }
    return results;
  }

  listCommands(projectId: string): RegisteredCommand[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM project_commands WHERE project_id = ? AND enabled = 1 ORDER BY command_id`,
      )
      .all(projectId) as CommandRow[];
    return rows.map(mapCommand);
  }

  getCommand(projectId: string, commandId: string): RegisteredCommand | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM project_commands WHERE project_id = ? AND command_id = ? ORDER BY revision DESC LIMIT 1`,
      )
      .get(projectId, commandId) as CommandRow | undefined;
    return row ? mapCommand(row) : undefined;
  }
}

/**
 * 结构化参数校验（26 SPEC §5）：参数必须是字符串数组，且不含空字节或未解析 glob。
 * 不符合时抛 COMMAND_ARGUMENT_INVALID。
 */
export function validateCommandArguments(args: unknown): string[] {
  if (!Array.isArray(args)) {
    throw new AppError('COMMAND_ARGUMENT_INVALID', '命令参数必须是数组', {});
  }
  const result: string[] = [];
  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new AppError('COMMAND_ARGUMENT_INVALID', '命令参数必须是字符串', {});
    }
    if (arg.includes('\0')) {
      throw new AppError('COMMAND_ARGUMENT_INVALID', '命令参数包含非法空字节', {});
    }
    if (/[*?]/.test(arg)) {
      throw new AppError('COMMAND_ARGUMENT_INVALID', '命令参数包含未解析的 glob 模式', {});
    }
    result.push(arg);
  }
  return result;
}
