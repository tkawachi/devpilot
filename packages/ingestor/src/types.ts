export type RiskLevel = "low" | "medium" | "high";

export interface DigestEvent {
  id: string;
  type: string;
  source: string;
  message: string;
  createdAt: string;
  metadata: Record<string, unknown>;
  taskId?: string | null;
}

export interface VKLogIngest {
  content: string;
  source?: string;
  receivedAt?: string;
}

export interface GitDiffIngest {
  content: string;
  repository?: string;
  branch?: string;
  commit?: string;
  capturedAt?: string;
}

export interface TaskSeed {
  id?: string;
  title: string;
  status?: string;
  priority?: number;
  assignee?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface SummaryRecord {
  id?: string;
  taskId: string;
  status: string;
  summary: string;
  risk: RiskLevel;
  next_steps: string[];
  diff_summary: string;
  createdAt?: string;
}

export interface IngestOptions {
  since: string;
  limit?: number;
  filters?: string[];
  databaseFile?: string;
  vkLogs?: VKLogIngest[];
  gitDiffs?: GitDiffIngest[];
  tasks?: TaskSeed[];
}

export interface EventRecord extends DigestEvent {}

export interface DatabaseConfig {
  filename?: string;
}

export interface StoredSummaryRecord extends SummaryRecord {
  id: string;
}

export interface StoredTaskRecord extends TaskSeed {
  id: string;
}

export type PersistedSummary = SummaryRecord & { id: string };

export interface IngestResult {
  events: DigestEvent[];
  tasks: StoredTaskRecord[];
}

export interface SummaryPersistenceOptions {
  replaceExisting?: boolean;
}

export type SummaryBatch = SummaryRecord[];

export type SummaryInput = SummaryRecord | SummaryBatch;

export interface SummaryStore {
  recordSummaries(summary: SummaryInput, options?: SummaryPersistenceOptions): StoredSummaryRecord[];
}

export interface EventFilter {
  types?: string[];
  taskIds?: string[];
}

export interface EventQueryOptions {
  since: string;
  limit?: number;
  filters?: EventFilter;
}

export interface IngestorLifecycle {
  close(): void;
}

export interface IngestorInterface extends IngestorLifecycle {
  ingest(options: IngestOptions): Promise<IngestResult>;
  recordSummaries(summary: SummaryInput, options?: SummaryPersistenceOptions): StoredSummaryRecord[];
  listEvents(options: EventQueryOptions): DigestEvent[];
}
