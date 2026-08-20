import { describe, expect, it } from "vitest";
import { reportInputSchema } from "@/lib/validation";

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
