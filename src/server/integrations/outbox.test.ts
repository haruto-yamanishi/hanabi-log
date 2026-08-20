import { describe, expect, it, vi } from "vitest";

import type { OutboxJob, Report } from "@/lib/types";
import { type IntegrationFailure } from "@/server/integrations/errors";
import {
  createOutboxProcessor,
  decideOutboxRetry,
  makeOutboxDedupeKey,
} from "@/server/integrations/outbox";
import type { OutboxRepository } from "@/server/repositories/types";

const NOW = new Date("2026-08-19T00:00:00.000Z");

function report(): Report {
  return {
    id: "report-1",
    authorId: "member-1",
    author: {
      id: "member-1",
      displayName: "Hanabi",
    },
    reportDate: "2026-08-19",
    title: "設計方針",
    summary: "要約",
    activityArea: "ロボット",
    contentCategory: "進捗",
    activityText: "活動",
    learningText: "",
    issueText: "",
    nextActionText: "",
    themeTags: [],
    status: "published",
    version: 2,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    relatedLinks: [],
    attachments: [],
  };
}

function job(target: OutboxJob["target"], overrides: Partial<OutboxJob> = {}): OutboxJob {
  return {
    id: `job-${target}`,
    reportId: "report-1",
    target,
    action: "update",
    reportVersion: 2,
    dedupeKey: `report-1:${target}:update:2`,
    status: "pending",
    attempts: 0,
    availableAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function repository(jobs: OutboxJob[]): OutboxRepository {
  return {
    claimJobs: vi.fn(async () => jobs),
    getReport: vi.fn(async () => report()),
    getBinding: vi.fn(async () => null),
    saveSlackBinding: vi.fn(async () => undefined),
    saveNotionBinding: vi.fn(async () => undefined),
    completeJob: vi.fn(async () => undefined),
    completeSupersededJob: vi.fn(async () => undefined),
    retryJob: vi.fn(async () => undefined),
    enqueueIntegrationRetry: vi.fn(async () => undefined),
  };
}

describe("Outbox helpers", () => {
  it("uses the specified dedupe key contract", () => {
    expect(makeOutboxDedupeKey("r1", "notion", "publish", 3)).toBe(
      "r1:notion:publish:3",
    );
  });

  it("uses 1m, 5m, 30m, and 2h retries before dead", () => {
    const failure: IntegrationFailure = { code: "X", retryable: true };
    expect(decideOutboxRetry(0, NOW, failure).availableAt.toISOString()).toBe(
      "2026-08-19T00:01:00.000Z",
    );
    expect(decideOutboxRetry(1, NOW, failure).availableAt.toISOString()).toBe(
      "2026-08-19T00:05:00.000Z",
    );
    expect(decideOutboxRetry(2, NOW, failure).availableAt.toISOString()).toBe(
      "2026-08-19T00:30:00.000Z",
    );
    expect(decideOutboxRetry(3, NOW, failure).availableAt.toISOString()).toBe(
      "2026-08-19T02:00:00.000Z",
    );
    expect(decideOutboxRetry(4, NOW, failure).status).toBe("dead");
  });

  it("prioritizes Retry-After and immediately dead-letters permanent errors", () => {
    expect(
      decideOutboxRetry(0, NOW, {
        retryable: true,
        retryAfterMs: 12_000,
      }).availableAt.toISOString(),
    ).toBe("2026-08-19T00:00:12.000Z");
    expect(
      decideOutboxRetry(0, NOW, { retryable: false }).status,
    ).toBe("dead");
  });
});

describe("Outbox processor", () => {
  it("completes Notion independently when Slack fails", async () => {
    const repo = repository([job("slack"), job("notion")]);
    const slack = {
      sync: vi.fn(async () => {
        throw { statusCode: 503, code: "service_unavailable" };
      }),
    };
    const notion = {
      sync: vi.fn(async () => ({
        pageId: "page-1",
        pageUrl: "https://notion.test/page-1",
        operation: "updated" as const,
        status: "delivered" as const,
      })),
      refreshProperties: vi.fn(async () => undefined),
    };
    const processor = createOutboxProcessor({
      repository: repo,
      slack,
      notion,
      now: () => NOW,
    });

    const summary = await processor.processReportJobs("report-1");

    expect(summary).toMatchObject({
      claimed: 2,
      delivered: 1,
      retryScheduled: 1,
      persistenceFailures: 0,
    });
    expect(repo.completeJob).toHaveBeenCalledWith(
      "job-notion",
      expect.any(Object),
    );
    expect(repo.retryJob).toHaveBeenCalledWith(
      "job-slack",
      expect.objectContaining({ status: "failed", attempts: 1 }),
    );
    expect(repo.saveNotionBinding).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({ status: "delivered", pageId: "page-1" }),
    );
    expect(notion.refreshProperties).toHaveBeenCalledOnce();
  });

  it("enqueues a Notion retry when a Slack-only property refresh fails", async () => {
    const repo = repository([job("slack")]);
    vi.mocked(repo.getBinding).mockResolvedValue({
      reportId: "report-1",
      notionPageId: "page-1",
      notionStatus: "delivered",
      slackStatus: "failed",
      updatedAt: NOW.toISOString(),
    });
    const processor = createOutboxProcessor({
      repository: repo,
      slack: {
        sync: vi.fn(async () => ({
          channelId: "C1",
          messageTs: "100.1",
          permalink: "https://slack.test/thread",
          operation: "updated" as const,
        })),
      },
      notion: {
        sync: vi.fn(async () => {
          throw new Error("unused");
        }),
        refreshProperties: vi.fn(async () => {
          throw { statusCode: 503, code: "service_unavailable" };
        }),
      },
      now: () => NOW,
    });

    const summary = await processor.processPendingJobs();

    expect(summary).toMatchObject({ partial: 1, retryScheduled: 1 });
    expect(repo.enqueueIntegrationRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: "report-1",
        target: "notion",
        attempts: 1,
        availableAt: new Date("2026-08-19T00:01:00.000Z"),
      }),
    );
  });

  it("keeps text delivery partial and retries an image-only failure", async () => {
    const repo = repository([job("notion")]);
    const imageFailure: IntegrationFailure = {
      code: "NOTION_FILE_UPLOAD_NOT_READY",
      retryable: true,
    };
    const processor = createOutboxProcessor({
      repository: repo,
      slack: {
        sync: vi.fn(async () => {
          throw new Error("unused");
        }),
      },
      notion: {
        sync: vi.fn(async () => ({
          pageId: "page-1",
          pageUrl: "https://notion.test/page-1",
          operation: "updated" as const,
          status: "partial" as const,
          imageFailure,
        })),
        refreshProperties: vi.fn(async () => undefined),
      },
      now: () => NOW,
    });

    const summary = await processor.processPendingJobs();

    expect(summary.partial).toBe(1);
    expect(summary.retryScheduled).toBe(1);
    expect(repo.saveNotionBinding).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({ status: "partial", pageId: "page-1" }),
    );
    expect(repo.completeJob).not.toHaveBeenCalled();
  });

  it("persists Slack message IDs before retrying permalink lookup", async () => {
    const repo = repository([job("slack")]);
    const processor = createOutboxProcessor({
      repository: repo,
      slack: {
        sync: vi.fn(async () => ({
          channelId: "C1",
          messageTs: "100.1",
          permalink: null,
          operation: "posted" as const,
          permalinkFailure: {
            code: "SLACK_SERVICE_UNAVAILABLE",
            retryable: true,
          },
        })),
      },
      notion: {
        sync: vi.fn(async () => {
          throw new Error("unused");
        }),
        refreshProperties: vi.fn(async () => undefined),
      },
      now: () => NOW,
    });

    const summary = await processor.processPendingJobs();

    expect(summary).toMatchObject({ partial: 1, retryScheduled: 1 });
    expect(repo.saveSlackBinding).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({
        channelId: "C1",
        messageTs: "100.1",
        status: "partial",
      }),
    );
    expect(repo.completeJob).not.toHaveBeenCalled();
  });

  it("marks older versions complete without calling external adapters", async () => {
    const repo = repository([
      job("slack", { id: "old", reportVersion: 1 }),
    ]);
    const slack = {
      sync: vi.fn(async () => ({
        channelId: "C1",
        messageTs: "1.1",
        permalink: "https://slack.test/thread",
        operation: "updated" as const,
      })),
    };
    const notion = {
      sync: vi.fn(async () => ({
        pageId: "p1",
        operation: "updated" as const,
        status: "delivered" as const,
      })),
      refreshProperties: vi.fn(async () => undefined),
    };
    const processor = createOutboxProcessor({
      repository: repo,
      slack,
      notion,
      now: () => NOW,
    });

    const summary = await processor.processPendingJobs();

    expect(summary.superseded).toBe(1);
    expect(slack.sync).not.toHaveBeenCalled();
    expect(notion.sync).not.toHaveBeenCalled();
  });
});
