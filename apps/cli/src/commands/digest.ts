import { runDigestPipeline } from "../../../../packages/core/src/digest";

export interface CliDigestOptions {
  since: string;
  limit?: number;
  format?: string;
  includeRawEvents?: boolean;
}

export async function handleDigest(options: CliDigestOptions): Promise<void> {
  const result = await runDigestPipeline({
    since: options.since,
    limit: options.limit,
    includeRawEvents: options.includeRawEvents
  });

  const format = normalizeFormat(options.format);
  if (format === "text") {
    renderTextDigest(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

function normalizeFormat(format?: string): "json" | "text" {
  if (!format) {
    return "json";
  }
  const lowered = format.toLowerCase();
  return lowered === "text" ? "text" : "json";
}

function renderTextDigest(result: Awaited<ReturnType<typeof runDigestPipeline>>): void {
  const summary = result.summary;
  console.log(`# Digest since ${result.since}`);
  console.log(`Generated ${summary.generatedAt} (${summary.timezone}) using ${summary.model}`);

  if (summary.items.length) {
    console.log("\nSummary items:");
    for (const item of summary.items) {
      const riskLabel = item.risk ? ` [${item.risk}]` : "";
      console.log(`- ${item.summary}${riskLabel}`);
      if (item.next_steps.length) {
        for (const step of item.next_steps) {
          console.log(`    • ${step}`);
        }
      }
    }
  } else {
    console.log("\nNo summary items generated.");
  }

  if (result.events.length) {
    console.log("\nEvents:");
    for (const event of result.events) {
      console.log(`- [${event.type}] ${event.message}`);
    }
  }

  if (result.notifications.length) {
    console.log("\nNotifications:");
    for (const notification of result.notifications) {
      const details = typeof notification.payload?.text === "string"
        ? notification.payload.text
        : JSON.stringify(notification.payload);
      console.log(`- [${notification.channel}] ${details}`);
    }
  }
}
