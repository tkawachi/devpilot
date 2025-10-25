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
  console.log(`# Digest since ${result.since}`);
  console.log(result.summary.headline);
  if (result.summary.highlights.length) {
    console.log("\nHighlights:");
    for (const highlight of result.summary.highlights) {
      console.log(`- ${highlight}`);
    }
  }
  if (result.events.length) {
    console.log("\nEvents:");
    for (const event of result.events) {
      console.log(`- [${event.type}] ${event.message}`);
    }
  }
}
