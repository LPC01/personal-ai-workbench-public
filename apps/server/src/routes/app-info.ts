import type { FastifyInstance } from 'fastify';
import type { AppInfo } from '../app-info.js';

/** 应用信息 API（P8-06）：版本与数据目录。 */
export function registerAppInfoRoutes(app: FastifyInstance, info: AppInfo): void {
  app.get('/api/v1/app-info', async () => info);
}
