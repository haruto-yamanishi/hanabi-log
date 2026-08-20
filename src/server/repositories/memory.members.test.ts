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

describe("MemoryReportRepository report deletion", () => {
  it("allows only an Admin to permanently delete a report", async () => {
    const repository = new MemoryReportRepository();
    const admin = getDemoMember();
    const created = await repository.createDraft(admin, {
      reportDate: "2026-08-20",
      title: "削除権限テスト",
      summary: "",
      activityArea: "ロボット",
      contentCategory: "進捗",
      activityText: "削除権限を確認した。",
      learningText: "",
      issueText: "",
      nextActionText: "",
      themeTags: [],
      relatedLinks: [],
      attachments: [],
    });

    await expect(
      repository.deleteReport(created.id, { ...admin, role: "member" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(repository.getReport(created.id)).resolves.not.toBeNull();

    await repository.deleteReport(created.id, admin);
    await expect(repository.getReport(created.id)).resolves.toBeNull();
  });
});

describe("MemoryReportRepository report likes", () => {
  it("stores one like per member and returns the viewer state", async () => {
    const repository = new MemoryReportRepository();
    const actor = getDemoMember();
    const created = await repository.createDraft(actor, {
      reportDate: "2026-08-20",
      title: "いいねテスト",
      activityArea: "ロボット",
      contentCategory: "進捗",
      activityText: "いいねの保存を確認した。",
    });
    const published = await repository.publishReport(created.id, actor);

    await expect(repository.setReportLike(published.id, actor, true)).resolves.toEqual({
      likeCount: 1,
      liked: true,
      likedBy: [{ id: actor.id, displayName: actor.displayName, avatarUrl: actor.avatarUrl }],
    });
    await expect(repository.setReportLike(published.id, actor, true)).resolves.toEqual({
      likeCount: 1,
      liked: true,
      likedBy: [{ id: actor.id, displayName: actor.displayName, avatarUrl: actor.avatarUrl }],
    });
    await expect(repository.getReadableReport(published.id, actor)).resolves.toMatchObject({
      likeCount: 1,
      likedByCurrentUser: true,
    });
    await expect(repository.setReportLike(published.id, actor, false)).resolves.toEqual({
      likeCount: 0,
      liked: false,
      likedBy: [],
    });
  });
});
