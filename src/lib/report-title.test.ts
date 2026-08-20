import { describe, expect, it } from "vitest";
import { resolveReportTitle } from "@/lib/report-title";

describe("resolveReportTitle", () => {
  it("keeps a title entered by the author", () => {
    expect(resolveReportTitle("  駆動系を組み立てた  ", "山西遥斗")).toBe("駆動系を組み立てた");
  });

  it("generates a casual title from the author name when blank", () => {
    expect(resolveReportTitle("   ", "山西遥斗")).toBe("山西遥斗の雑多な日報");
  });

  it("keeps the generated title within the database limit", () => {
    const title = resolveReportTitle("", "とても長い名前".repeat(20));
    expect(Array.from(title)).toHaveLength(60);
    expect(title.endsWith("の雑多な日報")).toBe(true);
  });
});
