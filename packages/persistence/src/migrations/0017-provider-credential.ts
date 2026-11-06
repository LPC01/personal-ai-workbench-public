import type { Migration } from '../migration-runner.js';

/** 给 model_providers 增加 credential_ref（32 号 SPEC §3 CRED：Provider 绑定 credentialRef）。 */
export const providerCredentialMigration: Migration = {
  version: 17,
  name: 'provider-credential',
  up: (db) => {
    db.exec(`ALTER TABLE model_providers ADD COLUMN credential_ref TEXT;`);
  },
};
