import type { Summary } from "../../summarizer/src/index";
import type { DigestEvent } from "../../ingestor/src/index";

export interface Notification {
  channel: string;
  payload: Record<string, unknown>;
}

export async function emitDigest(summary: Summary, events: DigestEvent[]): Promise<Notification[]> {
  const notification: Notification = {
    channel: "stdout",
    payload: {
      headline: summary.headline,
      highlights: summary.highlights,
      eventCount: events.length
    }
  };

  return [notification];
}
