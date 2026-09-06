import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDatabase: vi.fn() }));
vi.mock("@/server/env", () => ({ env: { NODE_ENV: "test" }, isDemoMode: false }));

let cleanupOperationalData: typeof import("./retention").cleanupOperationalData;
let RETENTION_DAYS: typeof import("./retention").RETENTION_DAYS;

beforeAll(async () => {
  ({ cleanupOperationalData, RETENTION_DAYS } = await import("./retention"));
});

describe("operational retention", () => {
  it("keeps conservative retention windows", () => {
    expect(RETENTION_DAYS).toEqual({
      idempotencyKeys: 60,
      deliveredOutbox: 90,
      deadOutbox: 365,
      processedSlackEvents: 180,
      processedSlackReactions: 180,
    });
  });

  it("does not touch a database from unit-test runtime", async () => {
    await expect(cleanupOperationalData()).resolves.toEqual({
      idempotencyKeys: 0,
      deliveredOutbox: 0,
      deadOutbox: 0,
      processedSlackEvents: 0,
      processedSlackReactions: 0,
    });
  });
});
