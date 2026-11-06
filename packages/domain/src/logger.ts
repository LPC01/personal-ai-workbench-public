export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** 派生一个带固定关联字段（如 requestId/projectId）的子 logger。 */
  child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** 输出 sink（默认 console.log），注入后可测试。 */
  sink?: (line: string) => void;
  /** 基础字段，附加到每条日志。 */
  base?: Record<string, unknown>;
}

/** 结构化日志器：每条日志输出一行 JSON（level/message/timestamp + 关联字段）。 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = options.level ?? 'info';
  const sink = options.sink ?? ((line: string) => console.log(line));
  const base = options.base ?? {};

  function write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
      return;
    }
    const entry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...base,
      ...fields,
    };
    sink(JSON.stringify(entry));
  }

  function loggerFor(scope: Record<string, unknown>): Logger {
    return {
      debug: (m, f) => write('debug', m, { ...scope, ...f }),
      info: (m, f) => write('info', m, { ...scope, ...f }),
      warn: (m, f) => write('warn', m, { ...scope, ...f }),
      error: (m, f) => write('error', m, { ...scope, ...f }),
      child: (f) => loggerFor({ ...scope, ...f }),
    };
  }

  return loggerFor(base);
}
