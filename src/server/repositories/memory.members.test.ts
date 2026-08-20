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

  it("deletes an unused member and preserves an author with reports", async () => {
    const repository = new MemoryReportRepository();
    const unused = await repository.upsertMember({
      slackTeamId: "T_TEST",
      slackUserId: `U_UNUSED_${crypto.randomUUID()}`,
      displayName: "Unused member",
      role: "member",
    });
    await expect(repository.deleteMember(unused.id)).resolves.toBe("deleted");
    await expect(repository.getMember(unused.id)).resolves.toBeNull();

    const author = await repository.upsertMember({
      slackTeamId: "T_TEST",
      slackUserId: `U_AUTHOR_${crypto.randomUUID()}`,
      displayName: "Report author",
      role: "member",
    });
    await repository.createDraft(
      {
        id: author.id,
        slackUserId: author.slackUserId,
        displayName: author.displayName,
        role: author.role,
        isActive: author.isActive,
      },
      {
        reportDate: "2026-08-20",
        title: "履歴保護テスト",
        activityArea: "ロボット",
        contentCategory: "進捗",
        activityText: "メンバー削除時に日報を残す。",
      },
    );

    await expect(repository.deleteMember(author.id)).resolves.toBe("has_reports");
    await expect(repository.getMember(author.id)).resolves.not.toBeNull();
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

describe("MemoryReportRepository report approval", () => {
  it("holds an Inactive member report until an Admin approves it", async () => {
    const repository = new MemoryReportRepository();
    const admin = getDemoMember();
    const member = await repository.upsertMember({
      slackTeamId: "T_TEST",
      slackUserId: `U_INACTIVE_${crypto.randomUUID()}`,
      displayName: "Inactive member",
      role: "member",
    });
    const inactive = await repository.setMemberActivity(member.id, false);
    if (!inactive) throw new Error("member setup failed");
    const actor = {
      id: inactive.id,
      slackUserId: inactive.slackUserId,
      displayName: inactive.displayName,
      role: inactive.role,
      isActive: inactive.isActive,
    };
    const draft = await repository.createDraft(actor, {
      reportDate: "2026-08-20",
      title: "OBの活動記録",
      activityArea: "その他",
      contentCategory: "成果",
      activityText: "OBとして活動を支援した。",
    });

    const requested = await repository.publishReport(draft.id, actor);
    expect(requested.status).toBe("pending_approval");
    expect(requested.publishedAt).toBeNull();
    await expect(repository.claimJobs({
      reportId: draft.id,
      limit: 50,
      now: new Date(Date.now() + 1_000),
    })).resolves.toEqual([]);

    await expect(repository.approveReport(draft.id, actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const approved = await repository.approveReport(draft.id, {
      id: admin.id,
      slackUserId: admin.slackUserId,
      displayName: admin.displayName,
      role: admin.role,
      isActive: admin.isActive,
    });
    expect(approved.status).toBe("published");
    expect(approved.publishedAt).not.toBeNull();
    const jobs = await repository.claimJobs({
      reportId: draft.id,
      limit: 50,
      now: new Date(Date.now() + 1_000),
    });
    expect(new Set(jobs.map((job) => job.target))).toEqual(new Set(["slack", "notion"]));
  });
});

describe("MemoryReportRepository report ordering", () => {
  it("lists the latest publication first and preserves that order across pages", async () => {
    vi.useFakeTimers();
    try {
      const repository = new MemoryReportRepository();
      const member = await repository.upsertMember({
        slackTeamId: "T_TEST",
        slackUserId: `U_SORT_${crypto.randomUUID()}`,
        displayName: "Sort member",
        role: "member",
      });
      const actor = {
        id: member.id,
        slackUserId: member.slackUserId,
        displayName: member.displayName,
        role: member.role,
        isActive: member.isActive,
      };

      vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
      const older = await repository.createDraft(actor, {
        reportDate: "2030-01-02",
        title: "先に公開した日報",
        activityArea: "その他",
        contentCategory: "進捗",
        activityText: "先に公開する。",
      });
      await repository.publishReport(older.id, actor);

      vi.setSystemTime(new Date("2030-01-01T01:00:00.000Z"));
      const newer = await repository.createDraft(actor, {
        reportDate: "2030-01-01",
        title: "後から公開した日報",
        activityArea: "その他",
        contentCategory: "進捗",
        activityText: "後から公開する。",
      });
      await repository.publishReport(newer.id, actor);

      const firstPage = await repository.listReports({ authorId: actor.id, limit: 1 }, actor);
      expect(firstPage.reports.map((report) => report.id)).toEqual([newer.id]);
      expect(firstPage.nextCursor).not.toBeNull();

      const secondPage = await repository.listReports(
        { authorId: actor.id, limit: 1, cursor: firstPage.nextCursor ?? undefined },
        actor,
      );
      expect(secondPage.reports.map((report) => report.id)).toEqual([older.id]);
    } finally {
      vi.useRealTimers();
    }
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
