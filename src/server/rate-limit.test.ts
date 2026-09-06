import { describe, expect, it } from "vitest";
import {
  configuredRateLimit,
  extractClientIp,
  retryAfterSeconds,
} from "@/server/rate-limit";

describe("API rate limiting", () => {
  it("uses conservative defaults and accepts valid overrides", () => {
    expect(configuredRateLimit("write", {})).toBe(30);
    expect(configuredRateLimit("write", { RATE_LIMIT_WRITE_PER_MINUTE: "45" })).toBe(45);
    expect(configuredRateLimit("write", { RATE_LIMIT_WRITE_PER_MINUTE: "0" })).toBe(30);
    expect(configuredRateLimit("write", { RATE_LIMIT_WRITE_PER_MINUTE: "not-a-number" })).toBe(30);
  });

  it("extracts only the first trusted proxy address and bounds untrusted text", () => {
    expect(extractClientIp(new Headers({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" }))).toBe(
      "203.0.113.10",
    );
    expect(extractClientIp(new Headers({ "x-real-ip": "198.51.100.8" }))).toBe("198.51.100.8");
    expect(extractClientIp(new Headers())).toBe("unknown");
    expect(extractClientIp(new Headers({ "x-forwarded-for": "x".repeat(500) })).length).toBe(128);
  });

  it("returns Retry-After until the next fixed window", () => {
    expect(retryAfterSeconds(new Date("2026-09-07T00:00:00.000Z"))).toBe(60);
    expect(retryAfterSeconds(new Date("2026-09-07T00:00:59.250Z"))).toBe(1);
  });
});
