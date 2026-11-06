/** workbench.project/v1 契约 ID（26 SPEC §5）。 */
export const PROJECT_SCHEMA_ID = 'workbench.project/v1';

export interface ProjectCommand {
  id: string;
  type: 'service' | 'job';
  executable: string;
  arguments?: string[];
  cwd?: string;
  timeoutSeconds?: number;
  concurrency?: 'singleton' | 'parallel';
}

export interface ProjectManifest {
  schemaVersion: 'workbench.project/v1';
  project: {
    id: string;
    name: string;
    description?: string;
  };
  runtime: {
    root: string;
    port?: {
      strategy: 'dynamic';
      from: number;
      to: number;
      environmentVariable?: string;
    };
  };
  webUI?: {
    enabled: boolean;
    displayMode: 'external' | 'proxy' | 'embedded';
    startCommandId?: string;
    stopCommandId?: string;
    url?: string;
    healthCheck?: {
      type: 'http';
      url: string;
      timeoutSeconds?: number;
    };
  };
  commands?: ProjectCommand[];
  models?: {
    defaultProfileId: string;
    allowedProfileIds?: string[];
  };
  memory?: {
    defaultScope: string;
    crossProjectRecall?: boolean;
  };
}
