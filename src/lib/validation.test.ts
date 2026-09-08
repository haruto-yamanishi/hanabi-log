import { describe, expect, it } from "vitest";
import { reportInputSchema, uploadRequestSchema } from "@/lib/validation";

const valid = {
  reportDate: "2026-08-19",
  title: "駆動系の設計レビュー",
  activityArea: "ロボット" as const,
  contentCategory: "判断・意思決定" as const,
  activityText: "ギア比と重量配分をレビューした。",
};

describe("reportInputSchema", () => {
  it("fills an omitted summary", () => {
    expect(reportInputSchema.parse(valid).summary).toBe(valid.activityText);
  });

  it("accepts a blank title so the API can generate one from the author name", () => {
    expect(reportInputSchema.parse({ ...valid, title: "   " }).title).toBe("");
  });

  it("rejects more than five tags", () => {
    const result = reportInputSchema.safeParse({
      ...valid,
      themeTags: ["機械", "電装", "ソフトウェア", "CAD・設計", "製作", "競技"],
    });
    expect(result.success).toBe(false);
  });

  it("requires HTTPS links", () => {
    const result = reportInputSchema.safeParse({
      ...valid,
      relatedLinks: [{ label: "資料", url: "http://example.com", sortOrder: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a future JST date", () => {
    const result = reportInputSchema.safeParse({ ...valid, reportDate: "2999-01-01" });
    expect(result.success).toBe(false);
  });
});


describe("media uploads", () => {
  const attachment = { storagePath: "member/video.mp4", filename: "video.mp4", mimeType: "video/mp4", sizeBytes: 50 * 1024 * 1024 };

  it.each(["video/mp4", "video/quicktime", "video/webm"])("accepts %s through upload and report validation", (mimeType) => {
    const file = { ...attachment, mimeType };
    expect(uploadRequestSchema.safeParse(file).success).toBe(true);
    expect(reportInputSchema.safeParse({ ...valid, attachments: [file] }).success).toBe(true);
  });

  it("enforces image and video size limits on both APIs", () => {
    for (const file of [
      { ...attachment, sizeBytes: attachment.sizeBytes + 1 },
      { ...attachment, mimeType: "image/png", sizeBytes: 5 * 1024 * 1024 + 1 },
      { ...attachment, sizeBytes: 0 },
      { ...attachment, mimeType: "application/javascript" },
    ]) {
      expect(uploadRequestSchema.safeParse(file).success).toBe(false);
      expect(reportInputSchema.safeParse({ ...valid, attachments: [file] }).success).toBe(false);
    }
  });

  it("enforces the combined attachment limit", () => {
    expect(reportInputSchema.safeParse({ ...valid, attachments: [attachment, attachment] }).success).toBe(true);
    expect(reportInputSchema.safeParse({ ...valid, attachments: [attachment, attachment, { ...attachment, sizeBytes: 1 }] }).success).toBe(false);
  });
});
