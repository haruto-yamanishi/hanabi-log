import { describe, expect, it, vi } from "vitest";
import type { Report } from "@/lib/types";
import type { ReportRepository } from "@/server/repositories/types";
import {
  deliverWeeklyDigest,
  previousJstWeek,
  renderWeeklyDigest,
} from "@/server/integrations/weekly-digest";

type DigestRepository = Pick<
  ReportRepository,
  | "listWeeklyBestReports"
  | "claimWeeklyDigest"
  | "completeWeeklyDigest"
  | "failWeeklyDigest"
>;

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: "report-1",
    authorId: "member-1",
    author: { id: "member-1", slackUserId: "U123", displayName: "Hanabi member" },
    reportDate: "2026-08-12",
    title: "ギア比を決定",
    summary: "試走結果を比べてギア比を決めた。",
    activityArea: "ロボット",
    contentCategory: "判断・意思決定",
    activityText: "試走した。",
    learningText: "",
    issueText: "",
    nextActionText: "",
    themeTags: [],
    status: "published",
    version: 2,
    publishedAt: "2026-08-12T01:00:00.000Z",
    createdAt: "2026-08-12T01:00:00.000Z",
    updatedAt: "2026-08-12T01:00:00.000Z",
    relatedLinks: [],
    attachments: [],
    likeCount: 4,
    integration: {
      reportId: "report-1",
      notionStatus: "delivered",
      slackStatus: "delivered",
      slackPermalink: "https://slack.test/thread",
      updatedAt: "2026-08-12T01:00:00.000Z",
    },
    ...overrides,
  };
}

function repository(reports: Report[], claim: "claimed" | "delivered" | "processing" = "claimed"): DigestRepository {
  return {
    listWeeklyBestReports: vi.fn(async () => reports),
    claimWeeklyDigest: vi.fn(async () => claim),
    completeWeeklyDigest: vi.fn(async () => undefined),
    failWeeklyDigest: vi.fn(async () => undefined),
  };
}

describe("weekly digest", () => {
  it("uses the previous complete Monday-to-Sunday week in JST", () => {
    const period = previousJstWeek(new Date("2026-08-20T12:00:00.000Z"));
    expect(period).toMatchObject({ startDate: "2026-08-10", endDate: "2026-08-17" });
    expect(period.start.toISOString()).toBe("2026-08-09T15:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-08-16T15:00:00.000Z");
  });

  it("renders likes and routes discussion to the existing Slack thread", () => {
    const payload = renderWeeklyDigest(
      [report()],
      previousJstWeek(new Date("2026-08-20T12:00:00.000Z")),
      "https://log.example.test",
    );
    const serialized = JSON.stringify(payload.blocks);
    expect(serialized).toContain("ギア比を決定");
    expect(serialized).toContain(":heart: 4");
    expect(serialized).toContain("<@U123>");
    expect(serialized).toContain("https://slack.test/thread");
    expect(serialized).toContain("Slackで話す");
  });

  it("claims a period and sends one roundup containing up to two reports", async () => {
    const reports = [report(), report({ id: "report-2", title: "配線を改善" })];
    const repo = repository(reports);
    const slack = {
      postMessage: vi.fn(async () => ({ channel: "C_RANDOM", ts: "123.456" })),
    };

    const result = await deliverWeeklyDigest({
      repository: repo,
      slack,
      tokenChannelId: "C_RANDOM",
      appBaseUrl: "https://log.example.test",
      now: new Date("2026-08-20T12:00:00.000Z"),
    });

    expect(result).toEqual({ status: "delivered", reportCount: 2 });
    expect(slack.postMessage).toHaveBeenCalledOnce();
    expect(slack.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C_RANDOM" }),
    );
    expect(repo.completeWeeklyDigest).toHaveBeenCalledWith(
      expect.objectContaining({ messageTs: "123.456", periodStart: "2026-08-10" }),
    );
  });

  it("does not post a duplicate after the period was delivered", async () => {
    const repo = repository([report()], "delivered");
    const slack = {
      postMessage: vi.fn(async () => ({ channel: "C_RANDOM", ts: "123.456" })),
    };
    const result = await deliverWeeklyDigest({
      repository: repo,
      slack,
      tokenChannelId: "C_RANDOM",
      appBaseUrl: "https://log.example.test",
      now: new Date("2026-08-20T12:00:00.000Z"),
    });
    expect(result.status).toBe("already_delivered");
    expect(slack.postMessage).not.toHaveBeenCalled();
  });
});
