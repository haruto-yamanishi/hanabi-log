import { describe, expect, it } from "vitest";
import { HANABI_TIME_ZONE, toHanabiReportDate } from "./timezone";

describe("Hanabi timezone", () => {
  it("uses the IANA Asia/Tokyo timezone", () => {
    expect(HANABI_TIME_ZONE).toBe("Asia/Tokyo");
  });

  it("moves to the next report date at the Tokyo day boundary", () => {
    expect(toHanabiReportDate(new Date("2026-09-06T14:59:59.999Z"))).toBe("2026-09-06");
    expect(toHanabiReportDate(new Date("2026-09-06T15:00:00.000Z"))).toBe("2026-09-07");
  });

  it("handles year boundaries using timezone rules", () => {
    expect(toHanabiReportDate(new Date("2026-12-31T14:59:59.999Z"))).toBe("2026-12-31");
    expect(toHanabiReportDate(new Date("2026-12-31T15:00:00.000Z"))).toBe("2027-01-01");
  });

  it("rejects invalid instants", () => {
    expect(() => toHanabiReportDate(new Date(Number.NaN))).toThrow("Invalid date");
  });
});
