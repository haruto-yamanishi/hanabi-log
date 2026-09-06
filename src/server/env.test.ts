import { describe, expect, it } from "vitest";
import {
  assertDemoModeAllowedInProduction,
  resolveDemoMode,
} from "./env";

describe("demo mode deployment safety", () => {
  it("never resolves demo mode in production", () => {
    expect(
      resolveDemoMode({
        nodeEnv: "production",
        demoMode: "true",
        databaseUrl: undefined,
      }),
    ).toBe(false);
  });

  it("keeps explicit demo mode available outside production", () => {
    expect(
      resolveDemoMode({
        nodeEnv: "development",
        demoMode: "true",
        databaseUrl: undefined,
      }),
    ).toBe(true);
  });

  it("keeps the credential-free local demo fallback outside production", () => {
    expect(
      resolveDemoMode({
        nodeEnv: "test",
        demoMode: undefined,
        databaseUrl: undefined,
      }),
    ).toBe(true);
    expect(
      resolveDemoMode({
        nodeEnv: "development",
        demoMode: undefined,
        databaseUrl: "postgresql://localhost/hanabi",
      }),
    ).toBe(false);
  });

  it("rejects an explicit production demo configuration", () => {
    expect(() =>
      assertDemoModeAllowedInProduction({
        nodeEnv: "production",
        demoMode: "true",
      }),
    ).toThrow("DEMO_MODE must never be enabled in production");
  });

  it("allows normal production and non-production configurations", () => {
    expect(() =>
      assertDemoModeAllowedInProduction({
        nodeEnv: "production",
        demoMode: "false",
      }),
    ).not.toThrow();
    expect(() =>
      assertDemoModeAllowedInProduction({
        nodeEnv: "development",
        demoMode: "true",
      }),
    ).not.toThrow();
  });
});
