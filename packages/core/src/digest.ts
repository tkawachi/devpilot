import type { IngestOptions, DigestEvent } from "../../ingestor/src/index";
import { ingestEvents } from "../../ingestor/src/index";
import { summarizeEvents, Summary } from "../../summarizer/src/index";
import { emitDigest, Notification } from "../../notifier/src/index";

export interface DigestPipelineOptions extends IngestOptions {
  includeRawEvents?: boolean;
}

export interface DigestResult {
  since: string;
  events: DigestEvent[];
  summary: Summary;
  notifications: Notification[];
}

export async function runDigestPipeline(options: DigestPipelineOptions): Promise<DigestResult> {
  const events = await ingestEvents(options);
  const summary = summarizeEvents(events);
  const notifications = await emitDigest(summary, events);

  return {
    since: options.since,
    events: options.includeRawEvents === false ? [] : events,
    summary,
    notifications
  };
}
