import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  AssistantDraft,
  AssistantDraftInput,
  AssistantModelRequirements,
  AssistantSchema,
} from '@workbench/contracts';
import type { HarnessToolId } from '@workbench/contracts';

interface AssistantDraftRow {
  id: string;
  extension_draft_id: string;
  system_prompt: string;
  input_schema_json: string;
  output_schema_json: string;
  tool_whitelist_json: string;
  model_requirements_json: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: AssistantDraftRow): AssistantDraft {
  return {
    id: row.id,
    extensionDraftId: row.extension_draft_id,
    systemPrompt: row.system_prompt,
    inputSchema: JSON.parse(row.input_schema_json) as AssistantSchema,
    outputSchema: JSON.parse(row.output_schema_json) as AssistantSchema,
    toolWhitelist: JSON.parse(row.tool_whitelist_json) as HarnessToolId[],
    modelRequirements: JSON.parse(row.model_requirements_json) as AssistantModelRequirements,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `id, extension_draft_id, system_prompt, input_schema_json, output_schema_json, tool_whitelist_json, model_requirements_json, created_at, updated_at`;

/** Assistant 草稿存储（26 SPEC §10.1 L1 Assistant）。 */
export class AssistantDraftStore {
  constructor(private readonly db: Database.Database) {}

  /** upsert：extensionDraftId 唯一，存在则覆盖。 */
  upsert(extensionDraftId: string, input: AssistantDraftInput): AssistantDraft {
    const existing = this.getByExtensionDraft(extensionDraftId);
    const now = new Date().toISOString();
    if (existing) {
      this.db
        .prepare(
          `UPDATE assistant_drafts SET system_prompt = ?, input_schema_json = ?, output_schema_json = ?, tool_whitelist_json = ?, model_requirements_json = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.systemPrompt,
          JSON.stringify(input.inputSchema),
          JSON.stringify(input.outputSchema),
          JSON.stringify(input.toolWhitelist ?? []),
          JSON.stringify(input.modelRequirements ?? {}),
          now,
          existing.id,
        );
      return this.get(existing.id) as AssistantDraft;
    }
    const id = `asd_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO assistant_drafts (id, extension_draft_id, system_prompt, input_schema_json, output_schema_json, tool_whitelist_json, model_requirements_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        extensionDraftId,
        input.systemPrompt,
        JSON.stringify(input.inputSchema),
        JSON.stringify(input.outputSchema),
        JSON.stringify(input.toolWhitelist ?? []),
        JSON.stringify(input.modelRequirements ?? {}),
        now,
        now,
      );
    return this.get(id) as AssistantDraft;
  }

  get(id: string): AssistantDraft | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM assistant_drafts WHERE id = ?`).get(id) as
      AssistantDraftRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  getByExtensionDraft(extensionDraftId: string): AssistantDraft | undefined {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM assistant_drafts WHERE extension_draft_id = ?`)
      .get(extensionDraftId) as AssistantDraftRow | undefined;
    return row ? mapRow(row) : undefined;
  }
}
