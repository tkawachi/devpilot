import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "uuid")
}));

import {
  parseVKLog,
  parseGitDiff,
  toDigestEventsFromVK,
  toDigestEventsFromDiff
} from "../src/parsers";
import type { GitDiffIngest, VKLogIngest } from "../src/types";
import { randomUUID } from "node:crypto";

const randomUUIDMock = randomUUID as unknown as Mock;

beforeEach(() => {
  randomUUIDMock.mockReset();
});

describe("parseVKLog", () => {
  it("parses structured VK logs and normalizes severity", () => {
    const log: VKLogIngest = {
      content: "[2024-05-01T09:10:11Z] Alice|ERROR: Build failed | task=42",
      source: "vk",
      receivedAt: "2024-05-01T09:15:00.000Z"
    };

    const events = parseVKLog(log);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      message: "Build failed",
      createdAt: "2024-05-01T09:10:11.000Z",
      author: "Alice",
      severity: "ERROR",
      taskId: "TASK-42"
    });
  });

  it("falls back to receivedAt when timestamp cannot be parsed", () => {
    const log: VKLogIngest = {
      content: "[not-a-date] Bob|INFO: All good",
      receivedAt: "2024-05-02T00:00:00.000Z"
    };

    const events = parseVKLog(log);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      createdAt: "2024-05-02T00:00:00.000Z",
      message: "All good",
      severity: "INFO"
    });
  });

  it("derives task identifiers from free-form messages", () => {
    const log: VKLogIngest = {
      content: "Investigating TASK-1234 regression",
      receivedAt: "2024-05-03T10:30:00.000Z"
    };

    const events = parseVKLog(log);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      message: "Investigating TASK-1234 regression",
      taskId: "TASK-1234",
      createdAt: "2024-05-03T10:30:00.000Z"
    });
  });
});

describe("parseGitDiff", () => {
  it("extracts diff statistics for multiple files", () => {
    const diff: GitDiffIngest = {
      content: [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 123..456 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@",
        "+const value = 1;",
        "-const value = 0;",
        "diff --git a/src/util.ts b/src/util.ts",
        "--- a/src/util.ts",
        "+++ b/src/util.ts",
        "+export const util = true;",
        "-export const helper = false;"
      ].join("\n"),
      capturedAt: "2024-05-04T12:00:00.000Z"
    };

    const parsed = parseGitDiff(diff);

    expect(parsed).toEqual([
      {
        filePath: "src/app.ts",
        additions: 1,
        deletions: 1,
        createdAt: "2024-05-04T12:00:00.000Z"
      },
      {
        filePath: "src/util.ts",
        additions: 1,
        deletions: 1,
        createdAt: "2024-05-04T12:00:00.000Z"
      }
    ]);
  });

  it("derives fallback information when diff header is missing", () => {
    const diff: GitDiffIngest = {
      content: [
        "@@",
        "+++ new-file.ts",
        "+console.log('hello');",
        "-console.log('bye');"
      ].join("\n")
    };

    const parsed = parseGitDiff(diff);

    expect(parsed).toEqual([
      {
        filePath: "new-file.ts",
        additions: 1,
        deletions: 1,
        createdAt: expect.any(String)
      }
    ]);
  });

  it("marks files as untracked when no filename hints are present", () => {
    const diff: GitDiffIngest = {
      content: "+added line\n-removed line"
    };

    const parsed = parseGitDiff(diff);

    expect(parsed).toEqual([
      {
        filePath: "untracked",
        additions: 1,
        deletions: 1,
        createdAt: expect.any(String)
      }
    ]);
  });
});

describe("digest event builders", () => {
  it("creates digest events from VK logs with incident severity", () => {
    randomUUIDMock.mockReturnValueOnce("uuid-1");

    const events = toDigestEventsFromVK(
      [
        {
          message: "Build failed",
          createdAt: "2024-05-05T01:02:03.000Z",
          author: "Alice",
          severity: "ERROR",
          taskId: "TASK-1"
        }
      ],
      "vk"
    );

    expect(events).toEqual([
      {
        id: "uuid-1",
        type: "incident",
        source: "vk",
        message: "Build failed",
        createdAt: "2024-05-05T01:02:03.000Z",
        metadata: {
          author: "Alice",
          severity: "error",
          rawSeverity: "ERROR",
          derivedTaskId: "TASK-1"
        },
        taskId: "TASK-1"
      }
    ]);
  });

  it("creates digest events from git diffs", () => {
    randomUUIDMock.mockReturnValueOnce("uuid-2");

    const events = toDigestEventsFromDiff(
      [
        {
          filePath: "src/app.ts",
          additions: 5,
          deletions: 2,
          createdAt: "2024-05-05T01:02:03.000Z"
        }
      ],
      { repository: "repo", branch: "main", commit: "abc123" }
    );

    expect(events).toEqual([
      {
        id: "uuid-2",
        type: "git_diff",
        source: "repo",
        message: "src/app.ts expansion (+5/-2)",
        createdAt: "2024-05-05T01:02:03.000Z",
        metadata: {
          filePath: "src/app.ts",
          additions: 5,
          deletions: 2,
          branch: "main",
          commit: "abc123"
        }
      }
    ]);
  });
});
