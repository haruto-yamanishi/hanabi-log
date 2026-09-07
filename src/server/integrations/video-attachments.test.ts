import { describe, expect, it, vi } from "vitest";

import type { Report } from "@/lib/types";
import { NotionReportService, type NotionApiPort } from "@/server/integrations/notion";
import { renderSlackReport } from "@/server/integrations/slack";

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: "report-video",
    authorId: "member-1",
    author: { id: "member-1", displayName: "Hanabi" },
    reportDate: "2026-09-07",
    title: "動画付きログ",
    summary: "動作確認動画を追加した。",
    activityArea: "ロボット",
    contentCategory: "進捗",
    activityText: "動作確認動画を追加した。",
    learningText: "",
    issueText: "",
    nextActionText: "",
    themeTags: [],
    status: "published",
    version: 1,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
    relatedLinks: [],
    attachments: [],
    ...overrides,
  };
}

describe("video attachment integrations", () => {
  it("keeps video URLs out of Slack image blocks and points users to the report page", () => {
    const payload = renderSlackReport(report({
      attachments: [
        {
          storagePath: "member/photo.webp",
          filename: "photo.webp",
          mimeType: "image/webp",
          sizeBytes: 100,
          sortOrder: 0,
          signedUrl: "https://storage.example.test/photo.webp",
        },
        {
          storagePath: "member/run.mp4",
          filename: "run.mp4",
          mimeType: "video/mp4",
          sizeBytes: 100,
          sortOrder: 1,
          signedUrl: "https://storage.example.test/run.mp4",
        },
      ],
    }), "https://log.example.test");

    const serialized = JSON.stringify(payload.blocks);
    expect(serialized).toContain("https://storage.example.test/photo.webp");
    expect(serialized).not.toContain("https://storage.example.test/run.mp4");
    expect(serialized).toContain("動画 1 件は日報ページで再生できます。");
  });

  it("does not turn a video-only report into a partial Notion sync", async () => {
    const api: NotionApiPort = {
      findPagesByReportId: vi.fn(async () => []),
      createPage: vi.fn(async () => ({ id: "page-1", url: "https://notion.test/page-1" })),
      updatePage: vi.fn(async ({ pageId }) => ({ id: pageId })),
      trashPage: vi.fn(async () => undefined),
      replacePageMarkdown: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => "upload-1"),
      appendImages: vi.fn(async () => undefined),
    };
    const service = new NotionReportService(api, "https://log.example.test");
    const result = await service.sync(report({
      attachments: [{
        storagePath: "member/run.webm",
        filename: "run.webm",
        mimeType: "video/webm",
        sizeBytes: 100,
        sortOrder: 0,
      }],
    }), null);

    expect(result.status).toBe("delivered");
    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(api.appendImages).not.toHaveBeenCalled();
  });
});
