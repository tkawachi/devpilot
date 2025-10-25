import { execFile } from "node:child_process";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { Ingestor } from "../../../../packages/ingestor/src/index.ts";
import { handleCollect } from "./collect";

const execFileAsync = promisify(execFile);

describe("collect command", () => {
  it("ingests new logs and commits into the workspace database", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "devpilot-collector-"));

    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["config", "user.name", "Collector"], { cwd });
    await execFileAsync("git", ["config", "user.email", "collector@example.com"], { cwd });

    const vkDir = path.join(cwd, ".vk");
    await mkdir(vkDir, { recursive: true });

    const logPath = path.join(vkDir, "agent.log");
    await writeFile(logPath, "[2024-06-20T12:00:00Z] bot|INFO: processed task #42\n");

    const tasksPath = path.join(vkDir, "tasks.json");
    await writeFile(tasksPath, JSON.stringify([{ id: "TASK-42", title: "Demo task" }], null, 2));

    const trackedFile = path.join(cwd, "file.txt");
    await writeFile(trackedFile, "hello\n");
    await execFileAsync("git", ["add", "file.txt"], { cwd });

    const commitEnv = {
      ...process.env,
      GIT_AUTHOR_DATE: "2024-06-20T12:00:00Z",
      GIT_COMMITTER_DATE: "2024-06-20T12:00:00Z"
    };
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd, env: commitEnv });

    await handleCollect({ workingDirectory: cwd, runOnce: true });

    const databasePath = path.join(cwd, "events.db");
    const databaseStats = await stat(databasePath);
    expect(databaseStats.size).toBeGreaterThan(0);

    const ingestor = new Ingestor({ databaseFile: databasePath });
    const events = ingestor.listEvents({ since: "1970-01-01T00:00:00.000Z" });
    ingestor.close();

    expect(events.length).toBeGreaterThan(0);
  });
});
