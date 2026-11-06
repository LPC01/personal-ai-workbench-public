import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Evidence, EvidenceKind, Issue, IssueStatus } from '@workbench/contracts';

interface IssueRow {
  id: string;
  title: string;
  description: string;
  status: string;
  project_id: string | null;
  extension_id: string | null;
  created_at: string;
  updated_at: string;
}

interface EvidenceRow {
  id: string;
  issue_id: string;
  kind: string;
  uri: string;
  created_at: string;
}

function mapIssue(row: IssueRow): Issue {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as IssueStatus,
    projectId: row.project_id ?? undefined,
    extensionId: row.extension_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    issueId: row.issue_id,
    kind: row.kind as EvidenceKind,
    uri: row.uri,
    createdAt: row.created_at,
  };
}

const ISSUE_COLUMNS =
  'id, title, description, status, project_id, extension_id, created_at, updated_at';

/** Issue 与 Evidence 存储（25 设计 §6.11）。 */
export class IssueStore {
  constructor(private readonly db: Database.Database) {}

  createIssue(input: {
    title: string;
    description: string;
    projectId?: string;
    extensionId?: string;
  }): Issue {
    const id = `iss_${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO issues (id, title, description, status, project_id, extension_id, created_at, updated_at)
         VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.description,
        input.projectId ?? null,
        input.extensionId ?? null,
        now,
        now,
      );
    return this.getIssue(id) as Issue;
  }

  getIssue(id: string): Issue | undefined {
    const row = this.db.prepare(`SELECT ${ISSUE_COLUMNS} FROM issues WHERE id = ?`).get(id) as
      IssueRow | undefined;
    return row ? mapIssue(row) : undefined;
  }

  listIssues(): Issue[] {
    const rows = this.db
      .prepare(`SELECT ${ISSUE_COLUMNS} FROM issues ORDER BY created_at`)
      .all() as IssueRow[];
    return rows.map(mapIssue);
  }

  updateStatus(id: string, status: IssueStatus): Issue {
    this.db
      .prepare('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
    return this.getIssue(id) as Issue;
  }

  addEvidence(issueId: string, kind: EvidenceKind, uri: string): Evidence {
    const id = `ev_${randomUUID()}`;
    this.db
      .prepare('INSERT INTO evidence (id, issue_id, kind, uri, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, issueId, kind, uri, new Date().toISOString());
    return this.getEvidence(id) as Evidence;
  }

  getEvidence(id: string): Evidence | undefined {
    const row = this.db
      .prepare('SELECT id, issue_id, kind, uri, created_at FROM evidence WHERE id = ?')
      .get(id) as EvidenceRow | undefined;
    return row ? mapEvidence(row) : undefined;
  }

  listEvidence(issueId: string): Evidence[] {
    const rows = this.db
      .prepare(
        'SELECT id, issue_id, kind, uri, created_at FROM evidence WHERE issue_id = ? ORDER BY created_at',
      )
      .all(issueId) as EvidenceRow[];
    return rows.map(mapEvidence);
  }
}
