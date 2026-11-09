import { describe, expect, it } from "vitest";
import { isHalloweenSeason, nextJstMidnight } from "./halloween-season";
describe("Halloween in JST", () => {
  it.each([
    ["2026-10-19T14:59:59.999Z", false],
    ["2026-10-19T15:00:00.000Z", true],
    ["2026-10-31T14:59:59.999Z", true],
    ["2026-10-31T15:00:00.000Z", false],
    ["2027-10-20T00:00:00.000Z", true],
  ])("uses JST boundaries: %s", (value, expected) => {
    expect(isHalloweenSeason(new Date(value))).toBe(expected);
  });
  it("schedules automatic removal at midnight even while the page stays open", () => {
    expect(nextJstMidnight(new Date("2026-10-31T14:59:59Z"))).toBe(Date.parse("2026-10-31T15:00:00Z"));
  });
});
