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

  it("keeps the 5 MiB per-image and 10 MiB report limits on the server", () => {
    const attachment = {
      storagePath: "owner/photo.jpg",
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 5 * 1024 * 1024,
    };
    expect(uploadRequestSchema.safeParse(attachment).success).toBe(true);
    expect(uploadRequestSchema.safeParse({ ...attachment, sizeBytes: attachment.sizeBytes + 1 }).success).toBe(false);
    expect(reportInputSchema.safeParse({ ...valid, attachments: [attachment, attachment] }).success).toBe(true);
    expect(reportInputSchema.safeParse({ ...valid, attachments: [{ ...attachment, sizeBytes: attachment.sizeBytes + 1 }] }).success).toBe(false);
    expect(reportInputSchema.safeParse({
      ...valid,
      attachments: [attachment, attachment, { ...attachment, sizeBytes: 1 }],
    }).success).toBe(false);
  });

  it("continues to reject unsupported image formats on the server", () => {
    expect(uploadRequestSchema.safeParse({ filename: "photo.heic", mimeType: "image/heic", sizeBytes: 1024 }).success).toBe(false);
  });
});
