import { describe, expect, it } from "vitest";
import {
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  createCspHeader,
  cspHeaderName,
} from "@/lib/security/csp";

describe("Content Security Policy", () => {
  it("uses a nonce and does not allow unsafe-eval in production", () => {
    const header = createCspHeader("abc123", false);
    expect(header).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(header).not.toContain("'unsafe-eval'");
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("frame-ancestors 'none'");
    expect(header).toContain("upgrade-insecure-requests");
  });

  it("allows private Supabase videos while keeping media sources scoped", () => {
    const header = createCspHeader("abc123", false);
    expect(header).toContain("media-src 'self' blob: https://*.supabase.co");
  });

  it("allows React development eval only in development", () => {
    const header = createCspHeader("devnonce", true);
    expect(header).toContain("'unsafe-eval'");
    expect(header).not.toContain("upgrade-insecure-requests");
  });

  it("switches between report-only and enforcement headers", () => {
    expect(cspHeaderName(false)).toBe(CSP_HEADER);
    expect(cspHeaderName(true)).toBe(CSP_REPORT_ONLY_HEADER);
  });
});
