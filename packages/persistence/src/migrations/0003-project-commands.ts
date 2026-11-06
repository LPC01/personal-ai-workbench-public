import type { Migration } from '../migration-runner.js';

/** 命令登记表（26 SPEC §8.2 DDL 原样）。 */
export const projectCommandsMigration: Migration = {
  version: 3,
  name: 'project-commands',
  up: (db) => {
    db.exec(`CREATE TABLE project_commands (
      project_id TEXT NOT NULL REFERENCES projects(id),
      command_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      definition_json TEXT NOT NULL,
      definition_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (project_id, command_id, revision)
    );`);
  },
};
