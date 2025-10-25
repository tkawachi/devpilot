import type { DigestEvent } from "../../ingestor/src/index";

export interface Summary {
  headline: string;
  highlights: string[];
}

export function summarizeEvents(events: DigestEvent[]): Summary {
  if (!events.length) {
    return {
      headline: "No activity detected",
      highlights: []
    };
  }

  const headline = `Captured ${events.length} activities`;
  const highlights = events.map((event) => `${event.type.toUpperCase()}: ${event.message}`);
  return { headline, highlights };
}
