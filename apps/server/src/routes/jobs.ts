import type { FastifyInstance } from 'fastify';
import { AppError } from '@workbench/domain';
import type { ProjectCatalog } from '@workbench/project-runtime';
import type { JobRunner } from '../job-runner.js';

/** Job 运行 API（26 SPEC §10.2 POST /projects/{projectId}/commands/{commandId}/runs）。 */
export function registerJobRoutes(
  app: FastifyInstance,
  catalog: ProjectCatalog,
  jobRunner: JobRunner,
): void {
  app.post('/api/v1/projects/:projectId/commands/:commandId/runs', async (request) => {
    const { projectId, commandId } = request.params as { projectId: string; commandId: string };
    const manifest = catalog.getManifest(projectId);
    if (!manifest) {
      throw new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { projectId } });
    }
    const command = manifest.commands?.find((c) => c.id === commandId);
    if (!command) {
      throw new AppError('COMMAND_NOT_REGISTERED', '命令未登记', {
        details: { projectId, commandId },
      });
    }
    if (command.type !== 'job') {
      throw new AppError('COMMAND_ARGUMENT_INVALID', '仅 job 类型命令可作为一次性 Run 运行', {
        details: { commandId },
      });
    }
    return jobRunner.start({ projectId, command, manifest });
  });
}
