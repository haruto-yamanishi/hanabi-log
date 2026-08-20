import { describe, expect, it } from "vitest";

import { safeInternalCallbackUrl } from "@/lib/navigation";

describe("safeInternalCallbackUrl", () => {
  it("keeps an internal report deep link", () => {
    expect(safeInternalCallbackUrl("/reports/r-1?from=slack")).toBe(
      "/reports/r-1?from=slack",
    );
  });

  it.each([
    "https://attacker.example/path",
    "//attacker.example/path",
    "/\\\\attacker.example/path",
    "/\n/attacker.example/path",
    "reports/r-1",
    undefined,
  ])("falls back for an unsafe callback: %s", (value) => {
    expect(safeInternalCallbackUrl(value)).toBe("/");
  });
});
