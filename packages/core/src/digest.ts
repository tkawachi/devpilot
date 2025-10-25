import {
  Ingestor,
  type DigestEvent,
  type IngestOptions,
  type SummaryRecord
} from "../../ingestor/src/index";
import {
  summarizeEvents,
  type SummaryEnvelope,
  type SummarizerOptions
} from "../../summarizer/src/index";
import { emitDigest, type Notification, type NotifierOptions } from "../../notifier/src/index";

export interface DigestPipelineOptions extends IngestOptions {
  includeRawEvents?: boolean;
  databaseFile?: string;
  summarizer?: SummarizerOptions;
  notifier?: NotifierOptions;
}

export interface DigestResult {
  since: string;
  events: DigestEvent[];
  summary: SummaryEnvelope;
  notifications: Notification[];
  summariesPersisted: SummaryRecord[];
}

export async function runDigestPipeline(options: DigestPipelineOptions): Promise<DigestResult> {
  const ingestor = new Ingestor({ databaseFile: options.databaseFile });

  try {
    const ingestResult = await ingestor.ingest(options);
    const events = ingestResult.events;

    const summary = await summarizeEvents(events, options.summarizer);
    const persistedSummaries = ingestor.recordSummaries(summary.items);
    const notifications = await emitDigest(summary, events, options.notifier);

    return {
      since: options.since,
      events: options.includeRawEvents === false ? [] : events,
      summary,
      notifications,
      summariesPersisted: persistedSummaries
    };
  } finally {
    ingestor.close();
  }
}
