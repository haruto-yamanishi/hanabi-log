import { describe, expect, it, vi } from "vitest";

import type { IntegrationBinding, Report } from "@/lib/types";
import {
  needsFullSlackThread,
  renderSlackFullReport,
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

  it("renders the complete body for a Slack thread when the card is abbreviated", () => {
    const input = report({
      activityText: `作業内容${"A".repeat(3_100)}`,
      learningText: "判断したこと",
    });
    expect(needsFullSlackThread(input)).toBe(true);
    const payload = renderSlackFullReport(input);
    expect(payload.text).toBe("日報全文: CNCなしで作れる設計へ");
    expect(payload.blocks.length).toBeGreaterThan(2);
    expect(JSON.stringify(payload.blocks)).toContain("判断したこと");
  });

  it("does not need a thread when the card contains the whole body", () => {
    const input = report({
      summary: "短い作業内容",
      activityText: "短い作業内容",
      learningText: "",
      issueText: "",
      nextActionText: "",
    });
    expect(needsFullSlackThread(input)).toBe(false);
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

  it("includes related links and signed image previews", () => {
    const payload = renderSlackReport(
      report({
        relatedLinks: [{
          id: "link-1",
          label: "設計資料 | drive",
          url: "https://example.test/design?x=1&y=2",
          sortOrder: 0,
        }],
        attachments: [{
          id: "attachment-1",
          storagePath: "member/report/robot.png",
          filename: "robot.png",
          mimeType: "image/png",
          sizeBytes: 100,
          altText: "組み立てたロボット",
          sortOrder: 0,
          signedUrl: "https://storage.example.test/robot.png?token=signed",
        }],
      }),
      "https://log.example.test",
    );

    expect(JSON.stringify(payload.blocks)).toContain(
      "https://example.test/design?x=1&amp;y=2",
    );
    expect(JSON.stringify(payload.blocks)).toContain("設計資料 ¦ drive");
    expect(payload.blocks).toContainEqual(expect.objectContaining({
      type: "image",
      image_url: "https://storage.example.test/robot.png?token=signed",
      alt_text: "組み立てたロボット",
    }));
  });
});

describe("SlackReportService", () => {
  function api(): SlackApiPort {
    return {
      postMessage: vi.fn(async () => ({ channel: "C1", ts: "100.1" })),
      updateMessage: vi.fn(async () => undefined),
      deleteMessage: vi.fn(async () => undefined),
      getPermalink: vi.fn(async () => "https://slack.test/archives/C1/p1001"),
      getReplyCount: vi.fn(async () => 0),
    };
  }

  it("posts the card and complete body thread, then resolves the root permalink", async () => {
    const client = api();
    const service = new SlackReportService(
      client,
      "C1",
      "https://log.example.test",
    );

    const result = await service.sync(report(), null);

    expect(client.postMessage).toHaveBeenCalledTimes(2);
    expect(client.postMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      channel: "C1",
      threadTs: "100.1",
      text: "日報全文: CNCなしで作れる設計へ",
      metadata: {
        eventType: "hanabi_log_full_report",
        eventPayload: { report_id: "report-1" },
      },
    }));
    expect(client.updateMessage).not.toHaveBeenCalled();
    expect(client.getPermalink).toHaveBeenCalledWith({
      channel: "C1",
      messageTs: "100.1",
    });
    expect(result.operation).toBe("posted");
  });

  it("does not create an unnecessary thread for a short complete body", async () => {
    const client = api();
    const service = new SlackReportService(client, "C1", "https://log.example.test");
    await service.sync(report({
      summary: "短い作業内容",
      activityText: "短い作業内容",
      learningText: "",
      issueText: "",
      nextActionText: "",
    }), null);
    expect(client.postMessage).toHaveBeenCalledOnce();
  });

  it("keeps the root message binding and reports a retryable thread failure", async () => {
    const client = api();
    vi.mocked(client.postMessage)
      .mockResolvedValueOnce({ channel: "C1", ts: "100.1" })
      .mockRejectedValueOnce({ statusCode: 503, code: "service_unavailable" });
    const service = new SlackReportService(client, "C1", "https://log.example.test");

    const result = await service.sync(report(), null);

    expect(result).toMatchObject({
      channelId: "C1",
      messageTs: "100.1",
      followupFailure: {
        code: "SLACK_FULL_REPORT_THREAD_FAILED",
        retryable: true,
        statusCode: 503,
      },
    });
  });

  it("retries only the missing full-body thread for a partial binding", async () => {
    const client = api();
    const service = new SlackReportService(client, "C-new", "https://log.example.test");
    await service.sync(report(), {
      reportId: "report-1",
      notionStatus: "pending",
      slackStatus: "partial",
      slackChannelId: "C-existing",
      slackMessageTs: "200.2",
      slackPermalink: "https://slack.test/archives/C-existing/p2002",
      slackLastError: "SLACK_FULL_REPORT_THREAD_FAILED:503",
      updatedAt: "2026-08-19T00:00:00.000Z",
    });

    expect(client.updateMessage).toHaveBeenCalledOnce();
    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: "C-existing",
      threadTs: "200.2",
    }));
  });

  it("prepares private attachment URLs before posting", async () => {
    const client = api();
    const prepareReport = vi.fn(async (input: Report) => ({
      ...input,
      attachments: input.attachments.map((attachment) => ({
        ...attachment,
        signedUrl: "https://storage.example.test/signed-image",
      })),
    }));
    const service = new SlackReportService(
      client,
      "C1",
      "https://log.example.test",
      prepareReport,
    );
    const input = report({
      attachments: [{
        id: "attachment-1",
        storagePath: "member/report/robot.png",
        filename: "robot.png",
        mimeType: "image/png",
        sizeBytes: 100,
        sortOrder: 0,
      }],
    });

    await service.sync(input, null);

    expect(prepareReport).toHaveBeenCalledWith(input);
    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      blocks: expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          image_url: "https://storage.example.test/signed-image",
        }),
      ]),
    }));
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
