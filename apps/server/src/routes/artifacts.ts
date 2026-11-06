import type { FastifyInstance } from 'fastify';
import { AppError } from '@workbench/domain';
import type { ArtifactStore } from '@workbench/persistence';

/** Artifact API（26 SPEC §10.2）：列表 + 下载。 */
export function registerArtifactRoutes(app: FastifyInstance, artifactStore: ArtifactStore): void {
  app.get('/api/v1/runs/:runId/artifacts', async (request) => {
    const { runId } = request.params as { runId: string };
    const items = artifactStore.listByRun(runId);
    return { runId, items, total: items.length };
  });

  app.get('/api/v1/artifacts/:artifactId', async (request, reply) => {
    const { artifactId } = request.params as { artifactId: string };
    const artifact = artifactStore.get(artifactId);
    if (!artifact) {
      throw new AppError('ARTIFACT_NOT_FOUND', 'Artifact 不存在', { details: { artifactId } });
    }
    const content = artifactStore.readContent(artifactId);
    if (!content) {
      throw new AppError('ARTIFACT_NOT_FOUND', 'Artifact 文件缺失', { details: { artifactId } });
    }
    return reply
      .type(artifact.mediaType ?? 'application/octet-stream')
      .header('Content-Length', String(content.length))
      .header('Content-Disposition', `attachment; filename="${artifact.logicalName}"`)
      .send(content);
  });
}
