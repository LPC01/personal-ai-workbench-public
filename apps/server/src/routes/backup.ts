import type { FastifyInstance } from 'fastify';
import { AppError } from '@workbench/domain';
import type { BackupService } from '../backup-service.js';

/** 备份 API（P8-04）：创建备份 + 哈希校验。 */
export function registerBackupRoutes(app: FastifyInstance, service: BackupService): void {
  app.post('/api/v1/backup', async (request) => {
    const { dir } = request.body as { dir?: string };
    if (!dir) {
      throw new AppError('COMMAND_ARGUMENT_INVALID', '缺少备份目录 dir', {});
    }
    return service.createBackup(dir);
  });

  app.get('/api/v1/backup/verify', async (request) => {
    const { dir } = request.query as { dir?: string };
    if (!dir) {
      throw new AppError('COMMAND_ARGUMENT_INVALID', '缺少备份目录 dir', {});
    }
    return service.verifyBackup(dir);
  });
}
