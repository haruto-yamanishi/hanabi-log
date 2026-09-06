import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDatabase: vi.fn() }));
vi.mock("@/server/env", () => ({ isDemoMode: true }));

let sanitizeAuditValue: typeof import("./audit").sanitizeAuditValue;

beforeAll(async () => {
  ({ sanitizeAuditValue } = await import("./audit"));
});

describe("audit value sanitization", () => {
  it("redacts sensitive keys recursively", () => {
    expect(
      sanitizeAuditValue({
        action: "notion.connected",
        accessToken: "secret-token",
        nested: { client_secret: "secret", safe: "ok" },
      }),
    ).toEqual({
      action: "notion.connected",
      accessToken: "[REDACTED]",
      nested: { client_secret: "[REDACTED]", safe: "ok" },
    });
  });

  it("bounds strings and nesting depth", () => {
    const result = sanitizeAuditValue({ value: "x".repeat(2100) }) as { value: string };
    expect(result.value.length).toBeLessThanOrEqual(2001);

    let value: unknown = "leaf";
    for (let index = 0; index < 12; index += 1) value = { child: value };
    expect(JSON.stringify(sanitizeAuditValue(value))).toContain("[MAX_DEPTH]");
  });
});
