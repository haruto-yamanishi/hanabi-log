import { describe, expect, it, vi } from "vitest";
import type { Report } from "@/lib/types";
import type { SlackPostMessageInput } from "@/server/integrations/slack";
import type { ReportRepository } from "@/server/repositories/types";
import {
  currentJstWeek,
  deliverWeeklyDigest,
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
      slackChannelId: "C_REPORTS",
      slackMessageTs: "100.1",
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
  it("uses the current Monday-to-Sunday week in JST", () => {
    const period = currentJstWeek(new Date("2026-08-20T12:00:00.000Z"));
    expect(period).toMatchObject({ startDate: "2026-08-17", endDate: "2026-08-24" });
    expect(period.start.toISOString()).toBe("2026-08-16T15:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-08-23T15:00:00.000Z");
  });

  it("renders one liked post and one discussion, both routed to Slack", () => {
    const liked = report({
      likedBy: [
        { id: "member-2", displayName: "山西遥斗", avatarUrl: null },
        { id: "member-3", displayName: "花火太郎", avatarUrl: null },
      ],
    });
    const discussed = report({ id: "report-2", title: "配線を改善" });
    const payload = renderWeeklyDigest(
      { bestPost: liked, bestDiscussion: { report: discussed, replyCount: 7 } },
      currentJstWeek(new Date("2026-08-20T12:00:00.000Z")),
      "https://log.example.test",
    );
    const serialized = JSON.stringify(payload.blocks);
    expect(serialized).toContain("ギア比を決定");
    expect(serialized).toContain("いいね 4件");
    expect(serialized).toContain("山西遥斗、花火太郎");
    expect(serialized).toContain("返信 7件");
    expect(serialized).toContain("<@U123>");
    expect(serialized).toContain("https://slack.test/thread");
    expect(serialized).toContain("Slackで話す");
  });

  it("selects the most-liked report and the thread with the most replies", async () => {
    const reports = [
      report(),
      report({
        id: "report-2",
        title: "配線を改善",
        integration: {
          reportId: "report-2",
          notionStatus: "delivered",
          slackChannelId: "C_REPORTS",
          slackMessageTs: "200.2",
          slackStatus: "delivered",
          slackPermalink: "https://slack.test/thread-2",
          updatedAt: "2026-08-12T01:00:00.000Z",
        },
      }),
    ];
    const repo = repository(reports);
    const slack = {
      postMessage: vi.fn(async (input: SlackPostMessageInput) => {
        void input;
        return { channel: "C_RANDOM", ts: "123.456" };
      }),
      getReplyCount: vi.fn(async ({ messageTs }: { messageTs: string }) =>
        messageTs === "200.2" ? 6 : 2,
      ),
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
    const posted = slack.postMessage.mock.calls[0][0];
    expect(posted.channel).toBe("C_RANDOM");
    expect(JSON.stringify(posted.blocks)).toContain("いいね 4件");
    expect(JSON.stringify(posted.blocks)).toContain("返信 6件");
    expect(JSON.stringify(posted.blocks)).toContain("配線を改善");
    expect(repo.completeWeeklyDigest).toHaveBeenCalledWith(
      expect.objectContaining({ messageTs: "123.456", periodStart: "2026-08-17" }),
    );
  });

  it("does not post a duplicate after the period was delivered", async () => {
    const repo = repository([report()], "delivered");
    const slack = {
      postMessage: vi.fn(async (input: SlackPostMessageInput) => {
        void input;
        return { channel: "C_RANDOM", ts: "123.456" };
      }),
      getReplyCount: vi.fn(async () => 0),
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
