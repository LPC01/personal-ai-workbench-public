import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ExtensionDraft,
  ExtensionDraftStatus,
  ExtensionSpec,
  StudioMessage,
  StudioMessageRole,
  StudioSession,
  StudioSessionStatus,
} from '@workbench/contracts';

interface SessionRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface DraftRow {
  id: string;
  session_id: string;
  spec_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapSession(row: SessionRow): StudioSession {
  return {
    id: row.id,
    title: row.title,
    status: row.status as StudioSessionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): StudioMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as StudioMessageRole,
    content: row.content,
    createdAt: row.created_at,
  };
}

function mapDraft(row: DraftRow): ExtensionDraft {
  return {
    id: row.id,
    sessionId: row.session_id,
    spec: JSON.parse(row.spec_json) as ExtensionSpec,
    status: row.status as ExtensionDraftStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Studio 会话 / 消息 / 草稿存储（26 SPEC §10.3 + 设计 §6.6）。 */
export class StudioStore {
  constructor(private readonly db: Database.Database) {}

  createSession(title: string): StudioSession {
    const id = `st_${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO studio_sessions (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, title, 'active', now, now);
    return this.getSession(id) as StudioSession;
  }

  getSession(id: string): StudioSession | undefined {
    const row = this.db
      .prepare('SELECT id, title, status, created_at, updated_at FROM studio_sessions WHERE id = ?')
      .get(id) as SessionRow | undefined;
    return row ? mapSession(row) : undefined;
  }

  updateSessionStatus(id: string, status: StudioSessionStatus): StudioSession {
    this.db
      .prepare('UPDATE studio_sessions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
    return this.getSession(id) as StudioSession;
  }

  addMessage(sessionId: string, role: StudioMessageRole, content: string): StudioMessage {
    const id = `stm_${randomUUID()}`;
    this.db
      .prepare(
        'INSERT INTO studio_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, sessionId, role, content, new Date().toISOString());
    return this.getMessage(id) as StudioMessage;
  }

  getMessage(id: string): StudioMessage | undefined {
    const row = this.db
      .prepare('SELECT id, session_id, role, content, created_at FROM studio_messages WHERE id = ?')
      .get(id) as MessageRow | undefined;
    return row ? mapMessage(row) : undefined;
  }

  listMessages(sessionId: string): StudioMessage[] {
    const rows = this.db
      .prepare(
        'SELECT id, session_id, role, content, created_at FROM studio_messages WHERE session_id = ? ORDER BY created_at',
      )
      .all(sessionId) as MessageRow[];
    return rows.map(mapMessage);
  }

  saveDraft(
    sessionId: string,
    spec: ExtensionSpec,
    status: ExtensionDraftStatus = 'draft',
  ): ExtensionDraft {
    const id = `extd_${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO extension_drafts (id, session_id, spec_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, sessionId, JSON.stringify(spec), status, now, now);
    return this.getDraft(id) as ExtensionDraft;
  }

  getDraft(id: string): ExtensionDraft | undefined {
    const row = this.db
      .prepare(
        'SELECT id, session_id, spec_json, status, created_at, updated_at FROM extension_drafts WHERE id = ?',
      )
      .get(id) as DraftRow | undefined;
    return row ? mapDraft(row) : undefined;
  }

  listDrafts(sessionId: string): ExtensionDraft[] {
    const rows = this.db
      .prepare(
        'SELECT id, session_id, spec_json, status, created_at, updated_at FROM extension_drafts WHERE session_id = ? ORDER BY created_at',
      )
      .all(sessionId) as DraftRow[];
    return rows.map(mapDraft);
  }

  /** 更新草稿状态（draft→confirmed→published）。 */
  updateDraftStatus(id: string, status: ExtensionDraftStatus): ExtensionDraft {
    this.db
      .prepare('UPDATE extension_drafts SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
    return this.getDraft(id) as ExtensionDraft;
  }
}
