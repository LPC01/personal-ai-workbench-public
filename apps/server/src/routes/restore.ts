import type { FastifyInstance } from 'fastify';
import { AppError } from '@workbench/domain';
import type { RestoreService } from '../restore-service.js';

/** 恢复 API（P8-05）：校验 → 临时验证 → 原子切换。 */
export function registerRestoreRoutes(app: FastifyInstance, service: RestoreService): void {
  app.post('/api/v1/restore', async (request) => {
    const { backupDir, targetDbPath } = request.body as {
      backupDir?: string;
      targetDbPath?: string;
    };
    if (!backupDir || !targetDbPath) {
      throw new AppError('COMMAND_ARGUMENT_INVALID', '缺少 backupDir 或 targetDbPath', {});
    }
    return service.restore(backupDir, targetDbPath);
  });
}
