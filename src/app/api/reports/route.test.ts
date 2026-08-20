import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Report, ReportPage } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  listReports: vi.fn(),
  createDraft: vi.fn(),
  signReportAttachments: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
}));

vi.mock("@/server/repositories", () => ({
  getReportRepository: () => ({
    createDraft: mocks.createDraft,
    listReports: mocks.listReports,
  }),
}));

vi.mock("@/server/db/storage", () => ({
  signReportAttachments: mocks.signReportAttachments,
}));

import { GET, POST } from "./route";

const user: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U_TEST",
  displayName: "Test member",
  role: "member",
};

const page: ReportPage = {
  reports: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      authorId: user.id,
      author: {
        id: user.id,
        slackUserId: user.slackUserId,
        displayName: user.displayName,
      },
      reportDate: "2026-08-20",
      title: "Drive base update",
      summary: "Finished wiring",
      activityArea: "ロボット",
      contentCategory: "進捗",
      activityText: "Finished wiring the drive base.",
      learningText: "",
      issueText: "",
      nextActionText: "Run diagnostics.",
      themeTags: [],
      status: "published",
      version: 1,
      publishedAt: "2026-08-20T00:00:00.000Z",
      archivedAt: null,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
      relatedLinks: [],
      attachments: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          storagePath: `${user.id}/report/image.png`,
          filename: "image.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          sortOrder: 0,
        },
      ],
      integration: null,
    },
  ],
  nextCursor: null,
};

describe("GET /api/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue(user);
    mocks.listReports.mockResolvedValue(page);
    mocks.signReportAttachments.mockImplementation(async (report: Report) => report);
  });

  it("returns list data without generating signed attachment URLs", async () => {
    const response = await GET(new Request("https://hanabi.example/api/reports"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await response.json()) as ReportPage;
    expect(body.nextCursor).toBeNull();
    expect(body.reports[0]).toMatchObject({
      id: page.reports[0].id,
      author: {
        id: user.id,
        displayName: user.displayName,
      },
    });
    expect(body.reports[0].author).not.toHaveProperty("email");
    expect(body.reports[0].author).not.toHaveProperty("slackTeamId");
    expect(body.reports[0].author).not.toHaveProperty("slackUserId");
    expect(body.reports[0].author).not.toHaveProperty("role");
    expect(mocks.listReports).toHaveBeenCalledWith(
      { status: "published", limit: 20 },
      user,
    );
    expect(mocks.signReportAttachments).not.toHaveBeenCalled();
  });

  it("generates a title from the authenticated member name when it is blank", async () => {
    const generated = {
      ...page.reports[0],
      title: "Test memberの雑多な日報",
      status: "draft" as const,
      publishedAt: null,
    };
    mocks.createDraft.mockResolvedValue(generated);

    const response = await POST(new Request("https://hanabi.example/api/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "blank-title-test",
      },
      body: JSON.stringify({
        reportDate: "2026-08-20",
        title: "   ",
        activityArea: "ロボット",
        contentCategory: "進捗",
        activityText: "配線を確認した。",
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.createDraft).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ title: "Test memberの雑多な日報" }),
      "blank-title-test",
    );
  });
});
