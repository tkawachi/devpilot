export interface IngestOptions {
  since: string;
  limit?: number;
  filters?: string[];
}

export interface DigestEvent {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export async function ingestEvents(options: IngestOptions): Promise<DigestEvent[]> {
  const { since, limit = 20 } = options;
  const now = new Date();
  const events: DigestEvent[] = [
    {
      id: "evt-1",
      type: "commit",
      message: "Initial placeholder commit processed",
      timestamp: now.toISOString(),
      metadata: { since }
    },
    {
      id: "evt-2",
      type: "issue",
      message: "Tracked issue updated",
      timestamp: now.toISOString(),
      metadata: { priority: "medium" }
    }
  ];

  return events.slice(0, limit);
}
