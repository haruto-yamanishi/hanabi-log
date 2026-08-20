import { describe, expect, it } from "vitest";

import { formatPublishedDateTime } from "@/components/report-card";

describe("formatPublishedDateTime", () => {
  it("formats the actual publication time in Japan time", () => {
    expect(formatPublishedDateTime("2026-08-20T14:16:00.000Z")).toBe(
      "8月20日 23時16分",
    );
  });
});
