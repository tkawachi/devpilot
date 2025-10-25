import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { SummaryEnvelope, SummaryItem } from "../../summarizer/src/index";
import type { DigestEvent, RiskLevel } from "../../ingestor/src/index";

export interface Notification {
  id: string;
  channel: string;
  type: "batch" | "immediate";
  status: "sent" | "failed" | "skipped";
  sentAt?: string;
  payload: Record<string, unknown>;
}

export interface NotifierOptions {
  mode?: "slack" | "macos";
  slackToken?: string;
  channel?: string;
  batchIntervalMs?: number;
  immediateRiskLevels?: RiskLevel[];
  autoStart?: boolean;
  fetchImpl?: typeof fetch;
  timezone?: string;
  macTitle?: string;
  macSubtitle?: string;
  macSound?: string;
}

interface PendingSummary {
  summary: SummaryEnvelope;
  events: DigestEvent[];
}

const DEFAULT_BATCH_INTERVAL = 10 * 60 * 1000;
const DEFAULT_IMMEDIATE_RISK: RiskLevel[] = ["high"];

export class SlackDigestNotifier {
  private readonly options: Required<
    Pick<NotifierOptions, "batchIntervalMs" | "immediateRiskLevels" | "autoStart" | "timezone">
  > & {
    slackToken?: string;
    channel?: string;
    fetchImpl: typeof fetch;
    mode: NotifierOptions["mode"];
    macTitle?: string;
    macSubtitle?: string;
    macSound?: string;
  };

  private pending: PendingSummary[] = [];

  private timer?: NodeJS.Timeout;

  constructor(options: NotifierOptions = {}) {
    this.options = {
      batchIntervalMs: options.batchIntervalMs ?? DEFAULT_BATCH_INTERVAL,
      immediateRiskLevels: options.immediateRiskLevels ?? DEFAULT_IMMEDIATE_RISK,
      autoStart: options.autoStart ?? true,
      timezone: options.timezone ?? "UTC",
      slackToken: options.slackToken,
      channel: options.channel,
      fetchImpl: options.fetchImpl ?? fetch,
      mode: options.mode ?? "slack",
      macTitle: options.macTitle,
      macSubtitle: options.macSubtitle,
      macSound: options.macSound
    };

    if (this.options.autoStart) {
      this.start();
    }
  }

  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.flush().catch(() => {
        // swallow periodic errors, they are reported via notifications
      });
    }, this.options.batchIntervalMs);
  }

  stop() {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async enqueue(summary: SummaryEnvelope, events: DigestEvent[]): Promise<Notification[]> {
    this.pending.push({ summary, events });
    const notifications: Notification[] = [];

    const immediate = summary.items.filter((item) =>
      this.options.immediateRiskLevels.includes(item.risk)
    );

    for (const item of immediate) {
      const notification = await this.sendImmediateAlert(item, summary);
      notifications.push(notification);
    }

    return notifications;
  }

  async flush(): Promise<Notification | null> {
    if (!this.pending.length) {
      return null;
    }

    const batches = [...this.pending];
    this.pending = [];

    const aggregatedItems = batches.flatMap((entry) => entry.summary.items);
    const aggregatedEvents = batches.flatMap((entry) => entry.events);
    const summaryIds = aggregatedItems.map((item) => item.id);
    const text = formatDigest(aggregatedItems, this.options.timezone, aggregatedEvents);

    const notification = await this.dispatchNotification({
      type: "batch",
      text,
      summaryIds
    });

    return notification;
  }

  async emit(summary: SummaryEnvelope, events: DigestEvent[]): Promise<Notification[]> {
    const immediateNotifications = await this.enqueue(summary, events);

    if (!this.options.autoStart) {
      const batch = await this.flush();
      return batch ? [...immediateNotifications, batch] : immediateNotifications;
    }

    return immediateNotifications;
  }

  private async sendImmediateAlert(item: SummaryItem, envelope: SummaryEnvelope): Promise<Notification> {
    const text = buildImmediateAlert(item, envelope, this.options.timezone);
    return this.dispatchNotification({
      type: "immediate",
      text,
      summaryIds: [item.id]
    });
  }

  private dispatchNotification(payload: {
    type: "batch" | "immediate";
    text: string;
    summaryIds: string[];
  }): Promise<Notification> {
    if (this.options.mode === "macos") {
      return postToMacOs({
        ...payload,
        title: this.options.macTitle,
        subtitle: this.options.macSubtitle,
        sound: this.options.macSound
      });
    }

    return this.postToSlack(payload);
  }

  private async postToSlack(payload: {
    type: "batch" | "immediate";
    text: string;
    summaryIds: string[];
  }): Promise<Notification> {
    const notification: Notification = {
      id: randomUUID(),
      channel: this.options.channel ?? "stdout",
      type: payload.type,
      status: "skipped",
      payload: {
        summaryIds: payload.summaryIds,
        text: payload.text
      }
    };

    if (!this.options.slackToken || !this.options.channel) {
      return notification;
    }

    try {
      const response = await this.options.fetchImpl("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${this.options.slackToken}`
        },
        body: JSON.stringify({
          channel: this.options.channel,
          text: payload.text
        })
      });

      const data = parseSlackResponse(await response.json());

      if (!data.ok) {
        return {
          ...notification,
          status: "failed",
          sentAt: new Date().toISOString(),
          payload: { ...notification.payload, error: data.error }
        };
      }

      return {
        ...notification,
        status: "sent",
        sentAt: new Date().toISOString()
      };
    } catch (error) {
      return {
        ...notification,
        status: "failed",
        sentAt: new Date().toISOString(),
        payload: { ...notification.payload, error: error instanceof Error ? error.message : String(error) }
      };
    }
  }
}

const DEFAULT_MACOS_TITLE = "DevPilot Digest";

async function postToMacOs(payload: {
  type: "batch" | "immediate";
  text: string;
  summaryIds: string[];
  title?: string;
  subtitle?: string;
  sound?: string;
}): Promise<Notification> {
  const resolvedTitle = payload.title ?? DEFAULT_MACOS_TITLE;
  const basePayload: Record<string, unknown> = {
    summaryIds: payload.summaryIds,
    text: payload.text,
    title: resolvedTitle
  };

  if (payload.subtitle) {
    basePayload.subtitle = payload.subtitle;
  }

  if (payload.sound) {
    basePayload.sound = payload.sound;
  }

  const baseNotification: Notification = {
    id: randomUUID(),
    channel: "macos",
    type: payload.type,
    status: "skipped",
    payload: basePayload
  };

  if (process.platform !== "darwin") {
    return {
      ...baseNotification,
      payload: {
        ...basePayload,
        reason: "unsupported_platform",
        platform: process.platform
      }
    };
  }

  const script = buildAppleScript({
    message: payload.text,
    title: resolvedTitle,
    subtitle: payload.subtitle,
    sound: payload.sound
  });

  try {
    await execFileAsync("osascript", ["-e", script]);
    return {
      ...baseNotification,
      status: "sent",
      sentAt: new Date().toISOString()
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      ...baseNotification,
      status: "failed",
      sentAt: new Date().toISOString(),
      payload: {
        ...basePayload,
        error: errorMessage
      }
    };
  }
}

function buildAppleScript(input: {
  message: string;
  title: string;
  subtitle?: string;
  sound?: string;
}): string {
  let script = `display notification ${serializeAppleScriptString(input.message)} with title ${serializeAppleScriptString(input.title)}`;

  if (input.subtitle) {
    script += ` subtitle ${serializeAppleScriptString(input.subtitle)}`;
  }

  if (input.sound) {
    script += ` sound name ${serializeAppleScriptString(input.sound)}`;
  }

  return script;
}

function serializeAppleScriptString(value: string): string {
  const literalFor = (segment: string): string =>
    `"${segment.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  const parts = value.split(/\r\n|\n|\r/);

  if (parts.length === 1) {
    return literalFor(parts[0]);
  }

  return parts.map(literalFor).join(" & linefeed & ");
}

function execFileAsync(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function emitDigest(
  summary: SummaryEnvelope,
  events: DigestEvent[],
  options: NotifierOptions = {}
): Promise<Notification[]> {
  const notifier = new SlackDigestNotifier({ ...options, autoStart: false });
  return notifier.emit(summary, events);
}

function formatDigest(items: SummaryItem[], timezone: string, events: DigestEvent[]): string {
  if (!items.length) {
    return "北極星メモ\n- 活動は検出されませんでした";
  }

  const ranking = buildPriorityRanking(items);
  const memo = buildPolarisMemo(ranking);
  const classifications = items
    .map((item) => `• ${item.taskId} — ${item.status} (${item.risk} risk)`)
    .join("\n");
  const nextSteps = items
    .flatMap((item) => item.next_steps.map((step) => `• ${item.taskId}: ${step}`))
    .join("\n");
  const diffSummary = items
    .map((item) => `• ${item.taskId}: ${item.diff_summary}`)
    .join("\n");
  const eventSummary = events
    .reduce<Record<string, number>>((acc, event) => {
      acc[event.type] = (acc[event.type] ?? 0) + 1;
      return acc;
    }, {});
  const eventLinesRaw = Object.entries(eventSummary)
    .map(([type, count]) => `• ${type}: ${count}`)
    .join("\n");
  const eventLines = eventLinesRaw || "• No events recorded";

  const generatedAt = new Date().toLocaleString("en-US", { timeZone: timezone });

  return [
    `北極星メモ\n${memo}`,
    `Classifications\n${classifications}`,
    `Priority Ranking\n${ranking.map((entry, index) => `${index + 1}. ${entry.taskId} (${entry.risk} risk, status: ${entry.status})`).join("\n")}`,
    `Next Steps\n${nextSteps}`,
    `Diff Summary\n${diffSummary}`,
    `Event Composition\n${eventLines}`,
    `Generated at ${generatedAt}`
  ].join("\n\n");
}

function buildImmediateAlert(item: SummaryItem, envelope: SummaryEnvelope, timezone: string): string {
  const generatedAt = new Date(envelope.generatedAt).toLocaleString("en-US", { timeZone: timezone });
  return [
    "🚨 Immediate Alert",
    `Task: ${item.taskId}`,
    `Risk: ${item.risk}`,
    `Status: ${item.status}`,
    `Summary: ${item.summary}`,
    `Next: ${item.next_steps.join("; ") || "No next steps captured"}`,
    `Generated: ${generatedAt}`
  ].join("\n");
}

interface RankedSummary extends SummaryItem {
  priorityScore: number;
}

function buildPriorityRanking(items: SummaryItem[]): RankedSummary[] {
  const scored = items.map((item) => ({
    ...item,
    priorityScore: computePriorityScore(item)
  }));

  scored.sort((a, b) => a.priorityScore - b.priorityScore);
  return scored;
}

function computePriorityScore(item: SummaryItem): number {
  const riskWeight = { high: 0, medium: 5, low: 10 }[item.risk];
  const statusWeight = getStatusWeight(item.status);
  return riskWeight + statusWeight;
}

function getStatusWeight(status: string): number {
  switch (status) {
    case "blocked":
    case "incident":
      return 0;
    case "in_review":
    case "in_progress":
      return 3;
    case "done":
    case "resolved":
      return 6;
    default:
      return 4;
  }
}

function parseSlackResponse(value: unknown): { ok: boolean; error?: string } {
  if (typeof value === "object" && value !== null && "ok" in value) {
    const record = value as Record<string, unknown>;
    const ok = Boolean(record.ok);
    const error = typeof record.error === "string" ? record.error : undefined;
    return { ok, error };
  }

  return { ok: false, error: "invalid_response" };
}

function buildPolarisMemo(ranking: RankedSummary[]): string {
  const top = ranking[0];
  if (!top) {
    return "- 最優先の課題はありません";
  }

  const highlights = top.next_steps.length
    ? top.next_steps.map((step) => `  • ${step}`).join("\n")
    : "  • 次のアクションは未定";

  return [`- ${top.taskId} (${top.risk} risk, ${top.status})`, highlights].join("\n");
}
