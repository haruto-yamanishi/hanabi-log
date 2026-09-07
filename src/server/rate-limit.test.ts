import { describe, expect, it } from "vitest";
import {
  configuredRateLimit,
  configuredRateLimitMode,
  extractClientIp,
  retryAfterSeconds,
} from "@/server/rate-limit";

describe("API rate limiting", () => {
  it("keeps enforcement off until rollout is explicitly activated", () => {
    expect(configuredRateLimitMode({})).toBe("off");
    expect(configuredRateLimitMode({ RATE_LIMIT_MODE: "off" })).toBe("off");
    expect(configuredRateLimitMode({ RATE_LIMIT_MODE: "enforce" })).toBe("enforce");
    expect(() => configuredRateLimitMode({ RATE_LIMIT_MODE: "typo" })).toThrow(
      "RATE_LIMIT_MODE must be either 'off' or 'enforce'",
    );
  });

  it("uses conservative defaults and accepts valid overrides", () => {
    expect(configuredRateLimit("write", {})).toBe(30);
    expect(configuredRateLimit("write", { RATE_LIMIT_WRITE_PER_MINUTE: "45" })).toBe(45);
    expect(configuredRateLimit("write", { RATE_LIMIT_WRITE_PER_MINUTE: "0" })).toBe(30);
    expect(configuredRateLimit("write", { RATE_LIMIT_WRITE_PER_MINUTE: "not-a-number" })).toBe(30);
  });

  it("trusts Vercel's proxy header in production and ignores spoofable fallbacks", () => {
    expect(
      extractClientIp(
        new Headers({
          "x-vercel-forwarded-for": "203.0.113.10, 10.0.0.1",
          "x-forwarded-for": "198.51.100.99",
        }),
        { NODE_ENV: "production" },
      ),
    ).toBe("203.0.113.10");
    expect(
      extractClientIp(
        new Headers({ "x-forwarded-for": "198.51.100.99" }),
        { NODE_ENV: "production" },
      ),
    ).toBe("unknown");
  });

  it("accepts local proxy headers outside production and bounds their values", () => {
    expect(
      extractClientIp(
        new Headers({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" }),
        { NODE_ENV: "development" },
      ),
    ).toBe("203.0.113.10");
    expect(
      extractClientIp(new Headers({ "x-real-ip": "198.51.100.8" }), { NODE_ENV: "development" }),
    ).toBe("198.51.100.8");
    expect(extractClientIp(new Headers(), { NODE_ENV: "development" })).toBe("unknown");
    expect(
      extractClientIp(
        new Headers({ "x-forwarded-for": "x".repeat(500) }),
        { NODE_ENV: "development" },
      ).length,
    ).toBe(128);
  });

  it("returns Retry-After until the next fixed window", () => {
    expect(retryAfterSeconds(new Date("2026-09-07T00:00:00.000Z"))).toBe(60);
    expect(retryAfterSeconds(new Date("2026-09-07T00:00:59.250Z"))).toBe(1);
  });
});
