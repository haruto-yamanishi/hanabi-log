import { describe, expect, it } from "vitest";
import { seasonalEventForDate } from "./seasonal-events";
describe("report-date seasonal stamps", () => {
  it.each(["2026-10-20", "2026-10-30", "2026-10-31", "2027-10-25"])("retains Halloween for %s independently of today's date", date => {
    expect(seasonalEventForDate(date)?.id).toBe("halloween");
  });
  it.each(["2026-10-19", "2026-11-01", "2026-12-25", "2026-10-32", "2026-02-30", "2026-10-30T00:00:00Z", "", "invalid"])("does not stamp %s", date => {
    expect(seasonalEventForDate(date)).toBeUndefined();
  });
});
