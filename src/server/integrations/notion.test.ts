import { describe, expect, it, vi } from "vitest";

import type { Attachment, IntegrationBinding, Report } from "@/lib/types";
import {
  mapNotionProperties,
  NotionReportService,
  renderNotionMarkdown,
  type NotionApiPort,
  type NotionFileUploadStatePort,
} from "@/server/integrations/notion";

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: "report-1",
    authorId: "member-1",
    author: {
      id: "member-1",
      displayName: "山西遥斗",
    },
    reportDate: "2026-08-19",
    title: "設計方針を整理",
    summary: "材料と加工条件から方針を整理した。",
    activityArea: "ロボット",
    contentCategory: "判断・意思決定",
    activityText: "CADを更新した。",
    learningText: "単純化が必要。",
    issueText: "規格の確定が必要。",
    nextActionText: "部材表を作る。",
    themeTags: ["機械", "CAD・設計"],
    status: "published",
    version: 1,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    relatedLinks: [],
    attachments: [],
    ...overrides,
  };
}

function api(): NotionApiPort {
  return {
    findPagesByReportId: vi.fn(async () => []),
    createPage: vi.fn(async () => ({
      id: "page-1",
      url: "https://notion.test/page-1",
    })),
    updatePage: vi.fn(async ({ pageId }) => ({
      id: pageId,
      url: `https://notion.test/${pageId}`,
    })),
    replacePageMarkdown: vi.fn(async () => undefined),
    uploadFile: vi.fn(async () => "upload-1"),
    appendImages: vi.fn(async () => undefined),
  };
}

describe("Notion rendering", () => {
  it("maps only writable properties with the fixed Japanese labels", () => {
    const binding: IntegrationBinding = {
      reportId: "report-1",
      notionStatus: "pending",
      slackStatus: "dead",
      slackPermalink: "https://slack.test/thread",
      updatedAt: "2026-08-19T00:00:00.000Z",
    };
    const properties = mapNotionProperties(
      report(),
      "https://log.example.test",
      binding,
    );

    expect(properties["Report UUID"]).toEqual({
      rich_text: [{ type: "text", text: { content: "report-1" } }],
    });
    expect(properties.Slack配信).toEqual({ select: { name: "配信失敗" } });
    expect(properties.Slackスレッド).toEqual({
      url: "https://slack.test/thread",
    });
    expect(properties).not.toHaveProperty("Log ID");
    expect(properties).not.toHaveProperty("作成日時");
  });

  it("escapes user markdown while retaining renderer-owned headings and links", () => {
    const markdown = renderNotionMarkdown(
      report({
        activityText: "# injected\n[click](https://evil.test) <script>",
        learningText: "",
        relatedLinks: [
          {
            label: "公式 [資料]",
            url: "https://example.test/a_(b)",
            sortOrder: 0,
          },
          { label: "unsafe", url: "http://example.test", sortOrder: 1 },
        ],
      }),
    );

    expect(markdown).toContain("## 今日やったこと");
    expect(markdown).toContain("\\# injected");
    expect(markdown).toContain("\\[click\\]\\(https://evil\\.test\\)");
    expect(markdown).toContain("&lt;script&gt;");
    expect(markdown).toContain(
      "- [公式 \\[資料\\]](https://example.test/a_%28b%29)",
    );
    expect(markdown).not.toContain("unsafe");
  });
});

describe("NotionReportService", () => {
  it("recovers by Report UUID before creating a page", async () => {
    const client = api();
    vi.mocked(client.findPagesByReportId).mockResolvedValue([
      { id: "recovered-page", url: "https://notion.test/recovered" },
    ]);
    const service = new NotionReportService(
      client,
      "https://log.example.test",
    );

    const result = await service.sync(report(), null);

    expect(client.createPage).not.toHaveBeenCalled();
    expect(client.updatePage).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: "recovered-page" }),
    );
    expect(client.replacePageMarkdown).toHaveBeenCalledOnce();
    expect(result.operation).toBe("recovered");
  });

  it("reuses a persisted File Upload ID after an image append failure", async () => {
    const client = api();
    vi.mocked(client.appendImages)
      .mockRejectedValueOnce({ statusCode: 503, code: "service_unavailable" })
      .mockResolvedValueOnce(undefined);
    const uploadedIds = new Map<string, string>();
    const state: NotionFileUploadStatePort = {
      get: vi.fn(async (reportId, key) => uploadedIds.get(`${reportId}:${key}`) ?? null),
      save: vi.fn(async (reportId, key, uploadId) => {
        uploadedIds.set(`${reportId}:${key}`, uploadId);
      }),
    };
    const content = { load: vi.fn(async () => new Blob(["image"])) };
    const attachment: Attachment = {
      id: "attachment-1",
      storagePath: "reports/report-1/image.png",
      filename: "image.png",
      mimeType: "image/png",
      sizeBytes: 5,
      altText: "robot",
      sortOrder: 0,
    };
    const service = new NotionReportService(
      client,
      "https://log.example.test",
      undefined,
      { content, state },
    );

    const first = await service.sync(report({ attachments: [attachment] }), null);
    expect(first.status).toBe("partial");
    expect(first.imageFailure?.retryable).toBe(true);

    const binding: IntegrationBinding = {
      reportId: "report-1",
      notionPageId: first.pageId,
      notionPageUrl: first.pageUrl,
      notionStatus: "partial",
      slackStatus: "pending",
      updatedAt: "2026-08-19T00:00:00.000Z",
    };
    const second = await service.sync(
      report({ attachments: [attachment] }),
      binding,
    );

    expect(second.status).toBe("delivered");
    expect(client.uploadFile).toHaveBeenCalledOnce();
    expect(content.load).toHaveBeenCalledOnce();
    expect(client.appendImages).toHaveBeenLastCalledWith("page-1", [
      { fileUploadId: "upload-1", altText: "robot" },
    ]);
  });
});
