import { describe, expect, it } from "vitest";
import { canTransition, makeDedupeKey, retryDelayMs } from "@/lib/report-state";

describe("report state", () => {
  it("requires an admin to restore an archived report", () => {
    expect(canTransition("archived", "published", "member")).toBe(false);
    expect(canTransition("archived", "published", "admin")).toBe(true);
  });

  it("builds the specified dedupe key", () => {
    expect(makeDedupeKey("report-1", "notion", "publish", 2)).toBe("report-1:notion:publish:2");
  });

  it("stops after the fourth retry delay", () => {
    expect(retryDelayMs(0)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(7_200_000);
    expect(retryDelayMs(4)).toBeNull();
  });
});
