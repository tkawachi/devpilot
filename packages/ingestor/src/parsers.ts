import { randomUUID } from "node:crypto";
import { DigestEvent, GitDiffIngest, VKLogIngest } from "./types";

const VK_LOG_PATTERNS: RegExp[] = [
  /^\[(?<timestamp>[^\]]+)\]\s*(?<author>[^:|]+)(?:\|(?<severity>[A-Z]+))?:\s*(?<message>.+?)(?:\s*\|\s*task=(?<taskId>[\w-]+))?$/i,
  /^(?<timestamp>\d{4}-\d{2}-\d{2}[^ ]*)\s+(?<severity>[A-Z]+)\s+(?<author>[^:]+):\s*(?<message>.+)$/
];

const TASK_TOKEN = /(TASK|ISSUE|BUG)[-#]?(?<id>\d{2,6})/i;

export interface ParsedVKEvent {
  message: string;
  createdAt: string;
  author?: string;
  severity?: string;
  taskId?: string;
}

export function parseVKLog(log: VKLogIngest): ParsedVKEvent[] {
  const lines = log.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const events: ParsedVKEvent[] = [];
  for (const line of lines) {
    let match: RegExpExecArray | null = null;
    for (const pattern of VK_LOG_PATTERNS) {
      const candidate = pattern.exec(line);
      if (candidate) {
        match = candidate;
        break;
      }
    }

    if (!match || !match.groups) {
      const fallbackTask = line.match(TASK_TOKEN)?.groups?.id;
      events.push({
        message: line,
        createdAt: log.receivedAt ?? new Date().toISOString(),
        taskId: fallbackTask ? `TASK-${fallbackTask}` : undefined
      });
      continue;
    }

    const timestamp = match.groups["timestamp"];
    const severity = match.groups["severity"];
    const author = match.groups["author"];
    const message = match.groups["message"].trim();
    const taskId = match.groups["taskId"] ?? match.groups["id"];
    const discoveredTask = taskId ?? line.match(TASK_TOKEN)?.groups?.id;

    events.push({
      message,
      createdAt: normalizeTimestamp(timestamp, log.receivedAt),
      severity,
      author,
      taskId: discoveredTask ? `TASK-${discoveredTask}` : undefined
    });
  }

  return events;
}

export interface ParsedGitDiff {
  filePath: string;
  additions: number;
  deletions: number;
  createdAt: string;
}

const DIFF_SPLIT_REGEX = /^diff --git\s+a\/(.+)\s+b\/(.+)$/gm;

export function parseGitDiff(diff: GitDiffIngest): ParsedGitDiff[] {
  const matches = Array.from(diff.content.matchAll(DIFF_SPLIT_REGEX));
  const results: ParsedGitDiff[] = [];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const startIndex = match.index ?? 0;
    const endIndex = matches[i + 1]?.index ?? diff.content.length;
    const chunk = diff.content.slice(startIndex, endIndex);
    const filePath = match[2] ?? match[1];

    const additions = countPrefix(chunk, "+");
    const deletions = countPrefix(chunk, "-");

    results.push({
      filePath,
      additions,
      deletions,
      createdAt: diff.capturedAt ?? new Date().toISOString()
    });
  }

  if (!results.length && diff.content.trim()) {
    const additions = countPrefix(diff.content, "+");
    const deletions = countPrefix(diff.content, "-");
    results.push({
      filePath: deriveFallbackFile(diff.content),
      additions,
      deletions,
      createdAt: diff.capturedAt ?? new Date().toISOString()
    });
  }

  return results;
}

export function toDigestEventsFromVK(
  parsed: ParsedVKEvent[],
  source: string
): DigestEvent[] {
  return parsed.map((entry) => ({
    id: randomUUID(),
    type: entry.severity?.toLowerCase() === "error" ? "incident" : "vk_log",
    source,
    message: entry.message,
    createdAt: entry.createdAt,
    metadata: {
      author: entry.author,
      severity: entry.severity?.toLowerCase(),
      rawSeverity: entry.severity,
      derivedTaskId: entry.taskId
    },
    taskId: entry.taskId
  }));
}

export function toDigestEventsFromDiff(
  parsed: ParsedGitDiff[],
  context: { repository?: string; branch?: string; commit?: string }
): DigestEvent[] {
  return parsed.map((entry) => ({
    id: randomUUID(),
    type: "git_diff",
    source: context.repository ?? "unknown",
    message: formatDiffMessage(entry),
    createdAt: entry.createdAt,
    metadata: {
      filePath: entry.filePath,
      additions: entry.additions,
      deletions: entry.deletions,
      branch: context.branch,
      commit: context.commit
    }
  }));
}

function formatDiffMessage(diff: ParsedGitDiff): string {
  const direction = diff.additions >= diff.deletions ? "expansion" : "shrink";
  return `${diff.filePath} ${direction} (+${diff.additions}/-${diff.deletions})`;
}

function countPrefix(chunk: string, prefix: string): number {
  return chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix) && !line.startsWith(prefix.repeat(3)))
    .length;
}

function deriveFallbackFile(content: string): string {
  const fileLine = content
    .split(/\r?\n/)
    .find((line) => line.startsWith("+++") || line.startsWith("---"));
  if (!fileLine) {
    return "untracked";
  }
  return fileLine.replace(/^\+\+\+\s+/, "").replace(/^---\s+/, "");
}

function normalizeTimestamp(timestamp: string | undefined, fallback?: string): string {
  if (!timestamp) {
    return fallback ?? new Date().toISOString();
  }

  const maybeDate = new Date(timestamp);
  if (!Number.isNaN(maybeDate.getTime())) {
    return maybeDate.toISOString();
  }

  return fallback ?? new Date().toISOString();
}
