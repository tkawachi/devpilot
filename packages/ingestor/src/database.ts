import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type {
  DatabaseConfig,
  DigestEvent,
  EventQueryOptions,
  EventRecord,
  IngestResult,
  IngestOptions,
  StoredSummaryRecord,
  StoredTaskRecord,
  SummaryInput,
  SummaryPersistenceOptions,
  TaskSeed
} from "./types";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

export class IngestorDatabase {
  private db: DatabaseSync;

  constructor(config: DatabaseConfig = {}) {
    const filename = config.filename ?? ":memory:";
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.initialise();
  }

  ingest(options: IngestOptions, events: EventRecord[], tasks: TaskSeed[]): IngestResult {
    const taskRecords = tasks.map((task) => this.upsertTask(task));
    events.forEach((event) => this.insertEvent(event));

    const queryResult = this.listEvents({
      since: options.since,
      limit: options.limit,
      filters: options.filters ? { types: options.filters } : undefined
    });

    return { events: queryResult, tasks: taskRecords };
  }

  insertEvent(event: EventRecord): DigestEvent {
    const payload = {
      id: event.id ?? randomUUID(),
      type: event.type,
      source: event.source,
      message: event.message,
      createdAt: event.createdAt,
      metadata: JSON.stringify(event.metadata ?? {}),
      taskId: event.taskId ?? null
    };

    const statement = this.db.prepare(`
      INSERT INTO events (id, type, source, message, created_at, metadata, task_id)
      VALUES (@id, @type, @source, @message, @createdAt, @metadata, @taskId)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        source = excluded.source,
        message = excluded.message,
        created_at = excluded.created_at,
        metadata = excluded.metadata,
        task_id = excluded.task_id
    `);

    statement.run(payload);

    return {
      id: payload.id,
      type: payload.type,
      source: payload.source,
      message: payload.message,
      createdAt: payload.createdAt,
      metadata: event.metadata ?? {},
      taskId: event.taskId
    };
  }

  upsertTask(task: TaskSeed): StoredTaskRecord {
    const id = task.id ?? randomUUID();
    const payload = {
      id,
      title: task.title,
      status: task.status ?? "open",
      priority: task.priority ?? 3,
      assignee: task.assignee ?? null,
      createdAt: task.createdAt ?? new Date().toISOString(),
      metadata: JSON.stringify(task.metadata ?? {})
    };

    const statement = this.db.prepare(`
      INSERT INTO tasks (id, title, status, priority, assignee, created_at, metadata)
      VALUES (@id, @title, @status, @priority, @assignee, @createdAt, @metadata)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        priority = excluded.priority,
        assignee = excluded.assignee,
        created_at = excluded.created_at,
        metadata = excluded.metadata
    `);

    statement.run(payload);

    return {
      id,
      title: payload.title,
      status: payload.status,
      priority: payload.priority,
      assignee: task.assignee,
      createdAt: payload.createdAt,
      metadata: task.metadata ?? {}
    };
  }

  listEvents(options: EventQueryOptions): DigestEvent[] {
    const filters: string[] = ["created_at >= @since"];
    const params: Record<string, unknown> = { since: options.since };

    if (options.filters?.types?.length) {
      filters.push(`type IN (${options.filters.types.map((_, idx) => `@type${idx}`).join(", ")})`);
      options.filters.types.forEach((type, idx) => {
        params[`type${idx}`] = type;
      });
    }

    if (options.filters?.taskIds?.length) {
      filters.push(`task_id IN (${options.filters.taskIds.map((_, idx) => `@task${idx}`).join(", ")})`);
      options.filters.taskIds.forEach((taskId, idx) => {
        params[`task${idx}`] = taskId;
      });
    }

    const limitClause = options.limit ? "LIMIT @limit" : "";
    if (options.limit) {
      params.limit = options.limit;
    }

    const statement = this.db.prepare(`
      SELECT id, type, source, message, created_at as createdAt, metadata, task_id as taskId
      FROM events
      WHERE ${filters.join(" AND ")}
      ORDER BY datetime(created_at) DESC
      ${limitClause}
    `);

    const rows = statement.all(params) as Array<{
      id: string;
      type: string;
      source: string;
      message: string;
      createdAt: string;
      metadata: string;
      taskId: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      source: row.source,
      message: row.message,
      createdAt: row.createdAt,
      metadata: safeParseMetadata(row.metadata),
      taskId: row.taskId ?? undefined
    }));
  }

  recordSummaries(summary: SummaryInput, options?: SummaryPersistenceOptions): StoredSummaryRecord[] {
    const summaries = Array.isArray(summary) ? summary : [summary];
    const replaceExisting = options?.replaceExisting ?? true;
    const inserted: StoredSummaryRecord[] = [];

    const insert = this.db.prepare(`
      INSERT INTO summaries (id, task_id, status, summary, risk, next_steps, diff_summary, created_at)
      VALUES (@id, @taskId, @status, @summary, @risk, @nextSteps, @diffSummary, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        status = excluded.status,
        summary = excluded.summary,
        risk = excluded.risk,
        next_steps = excluded.next_steps,
        diff_summary = excluded.diff_summary,
        created_at = excluded.created_at
    `);

    const deleteExisting = this.db.prepare(`DELETE FROM summaries WHERE task_id = ?`);

    for (const item of summaries) {
      if (replaceExisting && item.taskId) {
        deleteExisting.run(item.taskId);
      }

      const payload = {
        id: item.id ?? randomUUID(),
        taskId: item.taskId,
        status: item.status,
        summary: item.summary,
        risk: item.risk,
        nextSteps: JSON.stringify(item.next_steps ?? []),
        diffSummary: item.diff_summary,
        createdAt: item.createdAt ?? new Date().toISOString()
      };

      insert.run(payload);
      inserted.push({
        ...item,
        id: payload.id,
        next_steps: item.next_steps ?? [],
        createdAt: payload.createdAt
      });
    }

    return inserted;
  }

  close(): void {
    this.db.close();
  }

  private initialise() {
    const createEvents = `
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        task_id TEXT,
        FOREIGN KEY(task_id) REFERENCES tasks(id)
      );
    `;

    const createSummaries = `
      CREATE TABLE IF NOT EXISTS summaries (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        risk TEXT NOT NULL,
        next_steps TEXT NOT NULL,
        diff_summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id)
      );
    `;

    const createTasks = `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        assignee TEXT,
        created_at TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
    `;

    this.db.exec(createEvents);
    this.db.exec(createSummaries);
    this.db.exec(createTasks);
  }
}

function safeParseMetadata(serialised: string): Record<string, unknown> {
  try {
    return JSON.parse(serialised ?? "{}") as Record<string, unknown>;
  } catch (error) {
    return {};
  }
}
