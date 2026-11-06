import type { Migration } from '../migration-runner.js';
import { initMigration } from './0001-init.js';
import { projectsMigration } from './0002-projects.js';
import { projectCommandsMigration } from './0003-project-commands.js';
import { runsMigration } from './0004-runs.js';
import { artifactsMigration } from './0005-artifacts.js';
import { auditApprovalsMigration } from './0006-audit-approvals.js';
import { modelsMigration } from './0007-models.js';
import { harnessProfilesMigration } from './0008-harness.js';
import { harnessSessionsMigration } from './0009-harness-sessions.js';
import { extensionsMigration } from './0010-extensions.js';
import { studioMigration } from './0011-studio.js';
import { assistantDraftsMigration } from './0012-assistant-drafts.js';
import { draftChecksMigration } from './0013-draft-checks.js';
import { workflowsMigration } from './0014-workflows.js';
import { issuesMigration } from './0015-issues.js';
import { modelUsageMigration } from './0016-model-usage.js';
import { providerCredentialMigration } from './0017-provider-credential.js';
import { roomMigration } from './0018-room.js';
import { memoryCenterMigration } from './0019-memory-center.js';

/** 按版本顺序排列的全部 migration。 */
export const migrations: Migration[] = [
  initMigration,
  projectsMigration,
  projectCommandsMigration,
  runsMigration,
  artifactsMigration,
  auditApprovalsMigration,
  modelsMigration,
  harnessProfilesMigration,
  harnessSessionsMigration,
  extensionsMigration,
  studioMigration,
  assistantDraftsMigration,
  draftChecksMigration,
  workflowsMigration,
  issuesMigration,
  modelUsageMigration,
  providerCredentialMigration,
  roomMigration,
  memoryCenterMigration,
];
