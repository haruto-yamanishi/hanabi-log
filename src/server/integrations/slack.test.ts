import { describe, expect, it, vi } from "vitest";

import type { IntegrationBinding, Report } from "@/lib/types";
import {
  renderSlackReport,
  SlackReportService,
  type SlackApiPort,
} from "@/server/integrations/slack";

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: "report-1",
    authorId: "member-1",
    author: {
      id: "member-1",
      slackUserId: "U123",
      displayName: "Hanabi <@U123>",
    },
    reportDate: "2026-08-19",
    title: "CNCなしで作れる設計へ",
    summary: "要約 <@U999> & 確認",
    activityArea: "ロボット",
    contentCategory: "判断・意思決定",
    activityText: "今日やったこと",
    learningText: "学び",
    issueText: "相談",
    nextActionText: "次へ",
    themeTags: ["機械"],
    status: "published",
    version: 1,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    relatedLinks: [],
    attachments: [],
    ...overrides,
  };
}

describe("renderSlackReport", () => {
  it("renders a compact card, mentions the author, and neutralizes body markup", () => {
    const payload = renderSlackReport(report(), "https://log.example.test");
    expect(payload.text).toBe(
      "[ロボット] CNCなしで作れる設計へ\nWritten by <@U123>",
    );
    expect(JSON.stringify(payload.blocks)).toContain("Written by <@U123>");
    expect(JSON.stringify(payload.blocks)).toContain("要約 &lt;@U999&gt; &amp; 確認");
    expect(JSON.stringify(payload.blocks)).toContain(
      "https://log.example.test/reports/report-1",
    );
  });

  it("falls back to escaped display text for an invalid Slack user ID", () => {
    const payload = renderSlackReport(
      report({
        author: {
          id: "member-1",
          slackUserId: "invalid-user-id",
          displayName: "Hanabi <@U999>",
        },
      }),
      "https://log.example.test",
    );

    expect(payload.text).toContain("Written by Hanabi &lt;@U999&gt;");
    expect(payload.text).not.toContain("<@U999>");
  });

  it("marks archived reports and removes the action button", () => {
    const payload = renderSlackReport(
      report({ status: "archived" }),
      "https://log.example.test",
    );
    expect(payload.text).toContain("[アーカイブ]");
    expect(payload.blocks.some((block) => block.type === "actions")).toBe(false);
  });
});

describe("SlackReportService", () => {
  function api(): SlackApiPort {
    return {
      postMessage: vi.fn(async () => ({ channel: "C1", ts: "100.1" })),
      updateMessage: vi.fn(async () => undefined),
      deleteMessage: vi.fn(async () => undefined),
      getPermalink: vi.fn(async () => "https://slack.test/archives/C1/p1001"),
    };
  }

  it("posts once and resolves the permalink for an unbound report", async () => {
    const client = api();
    const service = new SlackReportService(
      client,
      "C1",
      "https://log.example.test",
    );

    const result = await service.sync(report(), null);

    expect(client.postMessage).toHaveBeenCalledOnce();
    expect(client.updateMessage).not.toHaveBeenCalled();
    expect(client.getPermalink).toHaveBeenCalledWith({
      channel: "C1",
      messageTs: "100.1",
    });
    expect(result.operation).toBe("posted");
  });

  it("updates the bound message rather than creating a duplicate", async () => {
    const client = api();
    const service = new SlackReportService(
      client,
      "C-new",
      "https://log.example.test",
    );
    const binding: IntegrationBinding = {
      reportId: "report-1",
      slackChannelId: "C-existing",
      slackMessageTs: "200.2",
      slackStatus: "delivered",
      notionStatus: "pending",
      updatedAt: "2026-08-19T00:00:00.000Z",
    };

    const result = await service.sync(report({ version: 2 }), binding);

    expect(client.postMessage).not.toHaveBeenCalled();
    expect(client.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C-existing", ts: "200.2" }),
    );
    expect(result.operation).toBe("updated");
  });

  it("returns the posted message IDs when permalink lookup fails", async () => {
    const client = api();
    vi.mocked(client.getPermalink).mockRejectedValueOnce({
      statusCode: 503,
      code: "service_unavailable",
    });
    const service = new SlackReportService(
      client,
      "C1",
      "https://log.example.test",
    );

    const result = await service.sync(report(), null);

    expect(result).toMatchObject({
      channelId: "C1",
      messageTs: "100.1",
      permalink: null,
      operation: "posted",
      permalinkFailure: {
        code: "SLACK_SERVICE_UNAVAILABLE",
        retryable: true,
      },
    });
  });

  it("deletes the exact bound bot message", async () => {
    const client = api();
    const service = new SlackReportService(
      client,
      "C-new",
      "https://log.example.test",
    );
    await service.remove({
      reportId: "report-1",
      slackChannelId: "C-existing",
      slackMessageTs: "200.2",
      slackStatus: "delivered",
      notionStatus: "pending",
      updatedAt: "2026-08-19T00:00:00.000Z",
    });

    expect(client.deleteMessage).toHaveBeenCalledWith({
      channel: "C-existing",
      ts: "200.2",
    });
  });
});
