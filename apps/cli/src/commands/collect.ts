import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  GitDiffIngest,
  Ingestor,
  VKLogIngest,
  createTaskSeed,
  TaskSeed
} from "../../../../packages/ingestor/src/index.ts";

const execFileAsync = promisify(execFile);

const DEFAULT_INTERVAL_MS = 120_000;
const DEFAULT_SINCE = new Date(0).toISOString();
const STATE_FILENAME = "events-collector-state.json";

interface CollectorState {
  lastPollIso: string;
  logOffsets: Record<string, number>;
  processedCommits: string[];
}

export interface CollectOptions {
  interval?: number;
  workingDirectory?: string;
  runOnce?: boolean;
}

export async function handleCollect(options: CollectOptions = {}): Promise<void> {
  const interval = options.interval ?? DEFAULT_INTERVAL_MS;
  const workingDirectory = path.resolve(options.workingDirectory ?? process.cwd());
  const vkDirectory = path.join(workingDirectory, ".vk");
  const stateFile = path.join(vkDirectory, STATE_FILENAME);
  const databaseFile = path.join(workingDirectory, "events.db");

  const ingestor = new Ingestor({ databaseFile });
  const state = await loadState(stateFile);

  const poll = async (): Promise<void> => {
    const since = state.lastPollIso ?? DEFAULT_SINCE;
    const nowIso = new Date().toISOString();

    try {
      const logResult = await collectVKLogs({
        workingDirectory,
        state,
        vkDirectory,
        nowIso
      });
      state.logOffsets = logResult.offsets;

      const gitResult = await collectGitDiffs({
        workingDirectory,
        since,
        processedCommits: state.processedCommits,
        capturedAt: nowIso
      });
      state.processedCommits = gitResult.processedCommits;

      const tasks = await collectTasks(vkDirectory);

      const ingestResult = await ingestor.ingest({
        since,
        vkLogs: logResult.logs,
        gitDiffs: gitResult.diffs,
        tasks
      });

      state.lastPollIso = nowIso;
      await saveState(stateFile, state);

      console.log(
        `[collector] Ingested ${ingestResult.events.length} events (${logResult.logs.length} logs, ${gitResult.diffs.length} diffs, ${tasks.length} tasks) since ${since}.`
      );
    } catch (error) {
      console.error("[collector] Failed to ingest:", error);
    }
  };

  if (options.runOnce) {
    await poll();
    ingestor.close();
    return;
  }

  await poll();

  let pollPromise: Promise<void> | null = null;
  const schedulePoll = () => {
    if (pollPromise) {
      return;
    }
    pollPromise = poll().finally(() => {
      pollPromise = null;
    });
  };

  const intervalHandle = setInterval(() => {
    void schedulePoll();
  }, interval);

  const shutdown = async () => {
    clearInterval(intervalHandle);
    if (pollPromise) {
      try {
        await pollPromise;
      } catch (error) {
        console.error("[collector] Poll during shutdown failed:", error);
      }
    }
    ingestor.close();
  };

  const handleSignal = (signal: NodeJS.Signals) => {
    console.log(`[collector] Received ${signal}, shutting down.`);
    void shutdown().finally(() => {
      process.exit(0);
    });
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  await new Promise<void>(() => {
    // Keep the process running until a signal is received.
  });
}

async function loadState(stateFile: string): Promise<CollectorState> {
  try {
    const contents = await readFile(stateFile, "utf8");
    const parsed = JSON.parse(contents) as Partial<CollectorState>;
    return {
      lastPollIso: parsed.lastPollIso ?? DEFAULT_SINCE,
      logOffsets: parsed.logOffsets ?? {},
      processedCommits: parsed.processedCommits ?? []
    };
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") {
      return { lastPollIso: DEFAULT_SINCE, logOffsets: {}, processedCommits: [] };
    }
    console.warn(`[collector] Unable to load state (${errno.message}). Using defaults.`);
    return { lastPollIso: DEFAULT_SINCE, logOffsets: {}, processedCommits: [] };
  }
}

async function saveState(stateFile: string, state: CollectorState): Promise<void> {
  const directory = path.dirname(stateFile);
  await mkdir(directory, { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
}

async function collectVKLogs(options: {
  workingDirectory: string;
  vkDirectory: string;
  state: CollectorState;
  nowIso: string;
}): Promise<{ logs: VKLogIngest[]; offsets: Record<string, number> }> {
  const offsets = { ...options.state.logOffsets };
  const logs: VKLogIngest[] = [];

  let entries: Dirent[] = [];
  try {
    entries = await readdir(options.vkDirectory, { withFileTypes: true });
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") {
      return { logs, offsets };
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".log")) {
      continue;
    }

    const fullPath = path.join(options.vkDirectory, entry.name);
    const relativePath = path.relative(options.workingDirectory, fullPath);
    const buffer = await readFile(fullPath);
    const previousOffset = offsets[relativePath] ?? 0;

    let startOffset = previousOffset;
    if (buffer.length < previousOffset) {
      startOffset = 0;
    }

    if (buffer.length <= startOffset) {
      offsets[relativePath] = buffer.length;
      continue;
    }

    const chunk = buffer.subarray(startOffset);
    const text = chunk.toString("utf8");
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    offsets[relativePath] = buffer.length;

    for (const line of lines) {
      logs.push({
        id: createDeterministicLogId(line),
        content: line,
        source: entry.name,
        receivedAt: options.nowIso
      });
    }
  }

  return { logs, offsets };
}

async function collectGitDiffs(options: {
  workingDirectory: string;
  since: string;
  processedCommits: string[];
  capturedAt: string;
}): Promise<{ diffs: GitDiffIngest[]; processedCommits: string[] }> {
  const processed = new Set(options.processedCommits);
  const diffs: GitDiffIngest[] = [];

  let commitStdout: string;
  try {
    const result = await execFileAsync("git", ["log", `--since=${options.since}`, "--pretty=format:%H"], {
      cwd: options.workingDirectory,
      env: { ...process.env, GIT_PAGER: "cat" }
    });
    commitStdout = result.stdout.trim();
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    console.warn(`[collector] Unable to read git history (${errno.message}). Skipping.`);
    return { diffs, processedCommits: Array.from(processed) };
  }

  if (!commitStdout) {
    return { diffs, processedCommits: Array.from(processed) };
  }

  const repository = await resolveRepository(options.workingDirectory);
  const branch = await resolveBranch(options.workingDirectory);

  const commits = commitStdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();

  for (const sha of commits) {
    if (processed.has(sha)) {
      continue;
    }
    try {
      const showResult = await execFileAsync(
        "git",
        ["show", sha, "--patch", "--no-color"],
        { cwd: options.workingDirectory, env: { ...process.env, GIT_PAGER: "cat" } }
      );
      diffs.push({
        content: showResult.stdout,
        repository,
        branch,
        commit: sha,
        capturedAt: options.capturedAt
      });
      processed.add(sha);
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      console.warn(`[collector] Unable to read diff for ${sha} (${errno.message}).`);
    }
  }

  const processedCommits = Array.from(processed);
  if (processedCommits.length > 200) {
    processedCommits.splice(0, processedCommits.length - 200);
  }

  return { diffs, processedCommits };
}

async function collectTasks(vkDirectory: string): Promise<TaskSeed[]> {
  const tasksFile = path.join(vkDirectory, "tasks.json");
  try {
    const contents = await readFile(tasksFile, "utf8");
    const parsed = JSON.parse(contents) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { tasks?: unknown }).tasks)
      ? ((parsed as { tasks?: unknown }).tasks as unknown[])
      : [];

    return entries.map((entry) => {
      const record = entry as Record<string, unknown>;
      const { id, title, status, priority, assignee, createdAt, metadata, ...rest } = record;
      const mergedMetadata = (metadata as Record<string, unknown> | undefined) ?? rest;
      return createTaskSeed((title as string) ?? "Untitled Task", {
        id: typeof id === "string" ? id : undefined,
        status: typeof status === "string" ? status : undefined,
        priority: typeof priority === "number" ? priority : undefined,
        assignee: typeof assignee === "string" ? assignee : undefined,
        createdAt: typeof createdAt === "string" ? createdAt : undefined,
        metadata: mergedMetadata
      });
    });
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code !== "ENOENT") {
      console.warn(`[collector] Unable to read tasks (${errno.message}).`);
    }
    return [];
  }
}

async function resolveRepository(cwd: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["config", "--get", "remote.origin.url"], { cwd });
    const value = result.stdout.trim();
    return value || undefined;
  } catch (error) {
    return undefined;
  }
}

async function resolveBranch(cwd: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    const branch = result.stdout.trim();
    return branch === "HEAD" ? undefined : branch;
  } catch (error) {
    return undefined;
  }
}

function createDeterministicLogId(line: string): string {
  const timestampMatch = /\[(?<timestamp>[^\]]+)\]/.exec(line);
  const timestamp = timestampMatch?.groups?.timestamp ?? "";
  const messagePart = line.includes(":") ? line.split(":").slice(1).join(":").trim() : line.trim();
  return createHash("sha1").update(`${timestamp}|${messagePart}`).digest("hex");
}
