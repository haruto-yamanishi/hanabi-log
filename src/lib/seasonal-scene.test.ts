import { describe, expect, it } from "vitest";
import { seasonalSceneForDate } from "./seasonal-scene";

describe("seasonal scenes (JST)", () => {
  it.each([
    ["2026-10-31T14:59:59Z", "halloween"],
    ["2026-10-31T15:00:00Z", "autumn"],
    ["2026-11-30T14:59:59Z", "autumn"],
    ["2026-11-30T15:00:00Z", "winter"],
    ["2026-12-10T14:59:59Z", "winter"],
    ["2026-12-10T15:00:00Z", "christmas"],
    ["2026-12-25T14:59:59Z", "christmas"],
    ["2026-12-25T15:00:00Z", "none"],
    ["2027-11-01T00:00:00Z", "autumn"],
    ["2027-01-01T00:00:00Z", "none"],
    ["invalid", "none"],
  ])("%s → %s", (date, scene) => {
    expect(seasonalSceneForDate(new Date(date))).toBe(scene);
  });
});
