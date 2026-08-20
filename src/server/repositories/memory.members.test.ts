import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getDemoMember,
  MemoryReportRepository,
} from "@/server/repositories/memory";

describe("MemoryReportRepository member management", () => {
  it("uses the configured role only on initial insert and preserves later role changes", async () => {
    const repository = new MemoryReportRepository();
    const slackUserId = `U_${crypto.randomUUID()}`;
    const input = {
      slackTeamId: "T_TEST",
      slackUserId,
      displayName: "New member",
      email: "member@example.com",
      avatarUrl: null,
    };

    const inserted = await repository.upsertMember({ ...input, role: "member" });
    const relogged = await repository.upsertMember({ ...input, role: "admin" });
    expect(relogged.role).toBe("member");

    const promoted = await repository.setMemberRole(inserted.id, "admin");
    expect(promoted?.role).toBe("admin");

    const afterAnotherLogin = await repository.upsertMember({ ...input, role: "member" });
    expect(afterAnotherLogin.role).toBe("admin");
    await expect(repository.listMembers()).resolves.toContainEqual(afterAnotherLogin);
  });
});

describe("MemoryReportRepository outbox claiming", () => {
  it("claims all targets for a report together and blocks a concurrent claim", async () => {
    const repository = new MemoryReportRepository();
    const actor = getDemoMember();
    const reportId = "00000000-0000-4000-8000-000000000101";
    await repository.requestIntegrationRetry(reportId, "slack", actor);
    await repository.requestIntegrationRetry(reportId, "notion", actor);
    const now = new Date(Date.now() + 1_000);

    const first = await repository.claimJobs({ reportId, limit: 50, now });
    const concurrent = await repository.claimJobs({ reportId, limit: 50, now });

    expect(new Set(first.map((job) => job.target))).toEqual(
      new Set(["slack", "notion"]),
    );
    expect(concurrent).toEqual([]);
  });
});
