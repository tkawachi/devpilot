import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("node:child_process", () => {
  return {
    execFile: vi.fn()
  };
});

import { emitDigest, type Notification } from "../src/index";
import type { SummaryEnvelope, SummaryItem } from "../../summarizer/src/index";
import type { DigestEvent } from "../../ingestor/src/index";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";

const execFileMock = execFile as unknown as Mock;

const baseSummaryItem: SummaryItem = {
  id: "item-1",
  taskId: "TASK-1",
  status: "in_progress",
  summary: "Important update",
  risk: "high",
  next_steps: ["Take action"],
  diff_summary: "changes"
};

const baseSummary: SummaryEnvelope = {
  generatedAt: new Date().toISOString(),
  timezone: "UTC",
  model: "test",
  items: [baseSummaryItem]
};

const baseEvent: DigestEvent = {
  id: "event-1",
  type: "log",
  source: "unit-test",
  message: "Digest event",
  createdAt: new Date().toISOString(),
  metadata: {}
};

beforeEach(() => {
  execFileMock.mockImplementation((_, __, callback?: (error: NodeJS.ErrnoException | null) => void) => {
    callback?.(null);
    return {} as ChildProcess;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function collectChannels(notifications: Notification[]): Set<string> {
  return new Set(notifications.map((notification) => notification.channel));
}

describe("SlackDigestNotifier transports", () => {
  it("sends notifications via Slack by default", async () => {
    const fetchMock = vi
      .fn(async () => ({
        json: async () => ({ ok: true })
      }))
      .mockName("fetchMock") as unknown as typeof fetch;

    const notifications = await emitDigest(baseSummary, [baseEvent], {
      slackToken: "token",
      channel: "C123",
      fetchImpl: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notifications).toHaveLength(2);
    expect(collectChannels(notifications)).toEqual(new Set(["C123"]));
    expect(notifications.every((notification) => notification.status === "sent")).toBe(true);
  });

  it("skips macOS notifications on non-darwin platforms", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;

    const notifications = await emitDigest(baseSummary, [baseEvent], {
      mode: "macos",
      slackToken: "token",
      channel: "C123",
      fetchImpl: fetchMock
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(notifications).toHaveLength(2);
    for (const notification of notifications) {
      expect(notification.channel).toBe("macos");
      expect(notification.status).toBe("skipped");
      const payload = notification.payload as Record<string, unknown>;
      expect(payload.reason).toBe("unsupported_platform");
    }
  });

  it("dispatches macOS notifications when supported", async () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");

    try {
      const notifications = await emitDigest(baseSummary, [baseEvent], {
        mode: "macos",
        macTitle: "Digest",
        macSound: "Submarine"
      });

      expect(execFileMock).toHaveBeenCalledTimes(2);
      expect(notifications).toHaveLength(2);
      expect(collectChannels(notifications)).toEqual(new Set(["macos"]));
      for (const notification of notifications) {
        expect(notification.status).toBe("sent");
        const payload = notification.payload as Record<string, unknown>;
        expect(payload.title).toBe("Digest");
        expect(payload.sound).toBe("Submarine");
      }
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("marks macOS notifications as failed when osascript errors", async () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    execFileMock.mockImplementationOnce((_, __, callback?: (error: NodeJS.ErrnoException | null) => void) => {
      callback?.(new Error("osascript failure"));
      return {} as ChildProcess;
    });
    execFileMock.mockImplementationOnce((_, __, callback?: (error: NodeJS.ErrnoException | null) => void) => {
      callback?.(new Error("osascript failure"));
      return {} as ChildProcess;
    });

    try {
      const notifications = await emitDigest(baseSummary, [baseEvent], {
        mode: "macos"
      });

      expect(execFileMock).toHaveBeenCalledTimes(2);
      expect(notifications.every((notification) => notification.status === "failed")).toBe(true);
      expect(
        notifications.every((notification) => {
          const payload = notification.payload as Record<string, unknown>;
          return String(payload.error).includes("osascript failure");
        }),
      ).toBe(true);
    } finally {
      platformSpy.mockRestore();
    }
  });
});
