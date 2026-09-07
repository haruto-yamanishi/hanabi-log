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

  it("keeps images at 5 MiB, allows videos up to 100 MiB, and caps a report at 200 MiB", () => {
    const image = {
      storagePath: "owner/photo.jpg",
      filename: "photo.jpg",
      mimeType: "image/jpeg" as const,
      sizeBytes: 5 * 1024 * 1024,
    };
    const video = {
      storagePath: "owner/run.mp4",
      filename: "run.mp4",
      mimeType: "video/mp4" as const,
      sizeBytes: 100 * 1024 * 1024,
    };

    expect(uploadRequestSchema.safeParse(image).success).toBe(true);
    expect(uploadRequestSchema.safeParse({ ...image, sizeBytes: image.sizeBytes + 1 }).success).toBe(false);
    expect(uploadRequestSchema.safeParse(video).success).toBe(true);
    expect(uploadRequestSchema.safeParse({ ...video, sizeBytes: video.sizeBytes + 1 }).success).toBe(false);
    expect(reportInputSchema.safeParse({ ...valid, attachments: [video, video] }).success).toBe(true);
    expect(reportInputSchema.safeParse({
      ...valid,
      attachments: [video, video, { ...image, sizeBytes: 1 }],
    }).success).toBe(false);
  });

  it("rejects unsupported image and video formats on the server", () => {
    expect(uploadRequestSchema.safeParse({ filename: "photo.heic", mimeType: "image/heic", sizeBytes: 1024 }).success).toBe(false);
    expect(uploadRequestSchema.safeParse({ filename: "clip.mov", mimeType: "video/quicktime", sizeBytes: 1024 }).success).toBe(false);
  });
});
