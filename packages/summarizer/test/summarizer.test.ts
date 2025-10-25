import { describe, it, expect } from "vitest";
import { summarizeEvents } from "../src/index";
import type { DigestEvent } from "../../ingestor/src/index";

describe("summarizeEvents", () => {
  it("creates heuristic summaries with derived metadata", async () => {
    const events: DigestEvent[] = [
      {
        id: "evt-2",
        type: "incident",
        source: "pagerduty",
        message: "Deployment blocked by failing health checks",
        createdAt: "2024-05-20T09:15:00.000Z",
        metadata: {
          author: "incident-bot"
        }
      },
      {
        id: "evt-1",
        type: "git_diff",
        source: "github",
        message: "Refactor job scheduler",
        createdAt: "2024-05-19T12:00:00.000Z",
        metadata: {
          additions: 120,
          deletions: 15,
          filePath: "services/scheduler.ts"
        }
      }
    ];

    const result = await summarizeEvents(events);

    expect(result.model).toBe("heuristic");
    expect(result.timezone).toBe("UTC");
    expect(result.items).toHaveLength(2);

    const [incident, diff] = result.items;

    expect(incident.summary).toContain("Deployment blocked");
    expect(incident.risk).toBe("high");
    expect(incident.status).toBe("blocked");
    expect(incident.next_steps).toContain("Coordinate with incident response");
    expect(incident.diff_summary).toBe("Log from incident-bot");

    expect(diff.taskId).toMatch(/^TASK-/);
    expect(diff.risk).toBe("medium");
    expect(diff.status).toBe("in_review");
    expect(diff.next_steps).toContain("Review diff for services/scheduler.ts");
    expect(diff.diff_summary).toBe("services/scheduler.ts: +120 / -15");
  });
});
