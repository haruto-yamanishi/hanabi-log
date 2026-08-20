import { describe, expect, it } from "vitest";
import { generateSummary, plainText, todayInJst } from "@/lib/text";

describe("text helpers", () => {
  it("generates a plain 100-character summary", () => {
    expect(generateSummary(`# **${"火".repeat(110)}**`)).toBe("火".repeat(100));
  });

  it("normalizes whitespace and markdown markers", () => {
    expect(plainText("## 判断\n\n**よかった**  こと")).toBe("判断 よかった こと");
  });

  it("uses the Asia/Tokyo calendar day", () => {
    expect(todayInJst(new Date("2026-08-18T15:05:00.000Z"))).toBe("2026-08-19");
  });
});
