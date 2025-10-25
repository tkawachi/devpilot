import { randomUUID } from "node:crypto";
import {
  DigestEvent,
  EventQueryOptions,
  IngestOptions,
  IngestResult,
  IngestorInterface,
  SummaryInput,
  SummaryPersistenceOptions,
  SummaryRecord,
  TaskSeed
} from "./types";
import { IngestorDatabase } from "./database";
import { parseGitDiff, parseVKLog, toDigestEventsFromDiff, toDigestEventsFromVK } from "./parsers";

export * from "./types";

export interface IngestorOptions {
  databaseFile?: string;
  defaultSource?: string;
}

const DEFAULT_SOURCE = "workspace";

export class Ingestor implements IngestorInterface {
  private database: IngestorDatabase;

  private defaultSource: string;

  constructor(options: IngestorOptions = {}) {
    this.database = new IngestorDatabase({ filename: options.databaseFile });
    this.defaultSource = options.defaultSource ?? DEFAULT_SOURCE;
  }

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const tasks = options.tasks ?? [];
    const vkLogs = options.vkLogs ?? [];
    const diffs = options.gitDiffs ?? [];

    const events: DigestEvent[] = [];

    for (const log of vkLogs) {
      const parsed = parseVKLog(log);
      const source = log.source ?? this.defaultSource;
      const digestEvents = toDigestEventsFromVK(parsed, source).map((event) => ({
        ...event,
        metadata: {
          ...event.metadata,
          sourceType: "vk_log",
          sourceLabel: log.source
        }
      }));
      events.push(...digestEvents);
    }

    for (const diff of diffs) {
      const parsed = parseGitDiff(diff);
      const digestEvents = toDigestEventsFromDiff(parsed, {
        repository: diff.repository ?? this.defaultSource,
        branch: diff.branch,
        commit: diff.commit
      }).map((event) => ({
        ...event,
        metadata: {
          ...event.metadata,
          repository: diff.repository,
          branch: diff.branch,
          commit: diff.commit
        }
      }));
      events.push(...digestEvents);
    }

    const enrichedEvents = events.map((event) => ({
      ...event,
      metadata: {
        ...event.metadata,
        ingestedAt: new Date().toISOString(),
        since: options.since
      }
    }));

    return this.database.ingest(options, enrichedEvents, tasks);
  }

  recordSummaries(summary: SummaryInput, options?: SummaryPersistenceOptions) {
    return this.database.recordSummaries(summary, options);
  }

  listEvents(options: EventQueryOptions) {
    return this.database.listEvents(options);
  }

  close(): void {
    this.database.close();
  }
}

let sharedIngestor: Ingestor | undefined;

export function createIngestor(options: IngestorOptions = {}): Ingestor {
  return new Ingestor(options);
}

export async function ingestEvents(options: IngestOptions & IngestorOptions): Promise<DigestEvent[]> {
  if (options.databaseFile) {
    const localIngestor = createIngestor({ databaseFile: options.databaseFile, defaultSource: options.defaultSource });
    const result = await localIngestor.ingest(options);
    localIngestor.close();
    return result.events;
  }

  if (!sharedIngestor) {
    sharedIngestor = createIngestor({ defaultSource: options.defaultSource });
  }

  const result = await sharedIngestor.ingest(options);
  return result.events;
}

export function createTaskSeed(title: string, overrides: Partial<TaskSeed> = {}): TaskSeed {
  return {
    id: overrides.id ?? `TASK-${randomUUID().slice(0, 8)}`,
    title,
    status: overrides.status ?? "open",
    priority: overrides.priority ?? 3,
    assignee: overrides.assignee,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    metadata: overrides.metadata ?? {}
  };
}

export function toSummaryRecord(summary: SummaryRecord): SummaryRecord {
  return {
    ...summary,
    id: summary.id,
    createdAt: summary.createdAt ?? new Date().toISOString()
  };
}
