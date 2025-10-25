import { randomUUID, createHash } from "node:crypto";
import type { DigestEvent, RiskLevel } from "../../ingestor/src/index";

export interface LLMClient {
  model: string;
  complete(prompt: string): Promise<string>;
}

export interface SummarizerOptions {
  llmClient?: LLMClient;
  timezone?: string;
  maxItems?: number;
  riskOverrides?: Record<string, RiskLevel>;
}

export interface SummaryItem {
  id: string;
  taskId: string;
  status: string;
  summary: string;
  risk: RiskLevel;
  next_steps: string[];
  diff_summary: string;
}

export interface SummaryEnvelope {
  generatedAt: string;
  timezone: string;
  model: string;
  items: SummaryItem[];
}

const DEFAULT_TIMEZONE = "UTC";

export async function summarizeEvents(
  events: DigestEvent[],
  options: SummarizerOptions = {}
): Promise<SummaryEnvelope> {
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const model = options.llmClient?.model ?? "heuristic";
  const maxItems = options.maxItems ?? 20;

  const ordered = [...events].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const trimmed = ordered.slice(0, maxItems);

  let items: SummaryItem[];

  if (options.llmClient && trimmed.length) {
    items = await summariseWithLLM(trimmed, options);
  } else {
    items = summariseHeuristically(trimmed, options);
  }

  return {
    generatedAt: new Date().toISOString(),
    timezone,
    model,
    items
  };
}

async function summariseWithLLM(events: DigestEvent[], options: SummarizerOptions): Promise<SummaryItem[]> {
  const prompt = buildPrompt(events, options);
  try {
    const raw = await options.llmClient!.complete(prompt);
    const parsed = parseLLMItems(raw);
    return parsed.map((item) => ({
      id: randomUUID(),
      ...item
    }));
  } catch (error) {
    return summariseHeuristically(events, options);
  }
}

function summariseHeuristically(events: DigestEvent[], options: SummarizerOptions): SummaryItem[] {
  return events.map((event) => {
    const risk = deriveRisk(event, options.riskOverrides);
    const taskId = resolveTaskId(event);
    const status = deriveStatus(event);
    const diffSummary = buildDiffSummary(event);
    const nextSteps = buildNextSteps(event, status);

    return {
      id: randomUUID(),
      taskId,
      status,
      summary: event.message,
      risk,
      next_steps: nextSteps,
      diff_summary: diffSummary
    };
  });
}

function resolveTaskId(event: DigestEvent): string {
  if (event.taskId) {
    return event.taskId;
  }
  const metadataTask = typeof event.metadata.taskId === "string" ? event.metadata.taskId : undefined;
  if (metadataTask) {
    return metadataTask;
  }
  const derived = createHash("sha1").update(event.id).digest("hex").slice(0, 8);
  return `TASK-${derived}`;
}

function deriveRisk(event: DigestEvent, overrides?: Record<string, RiskLevel>): RiskLevel {
  if (event.taskId && overrides?.[event.taskId]) {
    return overrides[event.taskId];
  }

  const severity = typeof event.metadata.severity === "string" ? event.metadata.severity : undefined;
  if (!severity && event.type === "git_diff") {
    const additions = Number(event.metadata.additions ?? 0);
    const deletions = Number(event.metadata.deletions ?? 0);
    if (additions + deletions > 200) {
      return "high";
    }
    if (additions + deletions > 50) {
      return "medium";
    }
    return "low";
  }

  switch (severity?.toLowerCase()) {
    case "critical":
    case "error":
    case "severe":
      return "high";
    case "warn":
    case "warning":
      return "medium";
    default:
      return event.type === "incident" ? "high" : "low";
  }
}

function deriveStatus(event: DigestEvent): string {
  const status = typeof event.metadata.status === "string" ? event.metadata.status : undefined;
  if (status) {
    return status;
  }
  if (event.type === "incident") {
    return "blocked";
  }
  if (event.type === "git_diff") {
    return "in_review";
  }
  return "in_progress";
}

function buildDiffSummary(event: DigestEvent): string {
  if (event.type !== "git_diff") {
    const author = typeof event.metadata.author === "string" ? event.metadata.author : "unknown";
    return `Log from ${author}`;
  }
  const filePath = typeof event.metadata.filePath === "string" ? event.metadata.filePath : "unknown";
  const additions = Number(event.metadata.additions ?? 0);
  const deletions = Number(event.metadata.deletions ?? 0);
  return `${filePath}: +${additions} / -${deletions}`;
}

function buildNextSteps(event: DigestEvent, status: string): string[] {
  const raw = event.metadata.nextSteps;
  if (Array.isArray(raw)) {
    return raw.filter((step): step is string => typeof step === "string");
  }

  const recommendations: string[] = [];
  if (event.type === "git_diff") {
    const filePath = typeof event.metadata.filePath === "string" ? event.metadata.filePath : "changes";
    recommendations.push(`Review diff for ${filePath}`);
  }

  if (status === "blocked" || status === "incident") {
    recommendations.push("Coordinate with incident response");
  }

  if (!recommendations.length) {
    recommendations.push("Confirm resolution and update task status");
  }

  return recommendations;
}

function parseLLMItems(raw: string): Array<Omit<SummaryItem, "id">> {
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error("LLM response must be an array");
  }

  return data.map((entry, index) => normaliseLLMItem(entry, index));
}

function normaliseLLMItem(value: unknown, index: number): Omit<SummaryItem, "id"> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`LLM summary at index ${index} is not an object`);
  }

  const record = value as Record<string, unknown>;
  const taskId = typeof record.taskId === "string" ? record.taskId : `TASK-${index + 1}`;
  const status = typeof record.status === "string" ? record.status : "in_progress";
  const summary = typeof record.summary === "string" ? record.summary : "";
  const riskValue = parseRisk(record.risk);
  const nextSteps = Array.isArray(record.next_steps)
    ? record.next_steps.filter((step): step is string => typeof step === "string")
    : [];
  const diffSummary = typeof record.diff_summary === "string" ? record.diff_summary : "";

  return {
    taskId,
    status,
    summary,
    risk: riskValue,
    next_steps: nextSteps,
    diff_summary: diffSummary
  };
}

function parseRisk(value: unknown): RiskLevel {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "medium";
}

function buildPrompt(events: DigestEvent[], options: SummarizerOptions): string {
  const header = `You are generating JSON summaries for ${events.length} events in timezone ${options.timezone ?? DEFAULT_TIMEZONE}.`;
  const instruction = `Return an array of JSON objects with keys taskId, status, summary, risk (low|medium|high), next_steps (array), diff_summary.`;
  const examples = events
    .map((event, index) => {
      const lines = [
        `Event ${index + 1}:`,
        `  id: ${event.id}`,
        `  type: ${event.type}`,
        `  message: ${event.message}`,
        `  metadata: ${JSON.stringify(event.metadata)}`
      ];
      return lines.join("\n");
    })
    .join("\n\n");

  return `${header}\n${instruction}\n${examples}`;
}
