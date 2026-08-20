import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Report } from "@/lib/types";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  getReadableReport: vi.fn(),
  deleteReport: vi.fn(),
  deleteReportResources: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
}));

vi.mock("@/server/repositories", () => ({
  getReportRepository: () => ({
    getReadableReport: mocks.getReadableReport,
    deleteReport: mocks.deleteReport,
  }),
}));

vi.mock("@/server/reports/delete-report-resources", () => ({
  deleteReportResources: mocks.deleteReportResources,
}));

import { DELETE } from "./route";

const admin: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U_ADMIN",
  displayName: "Admin",
  role: "admin",
};
const report: Report = {
  id: "20000000-0000-4000-8000-000000000001",
  authorId: admin.id,
  author: { id: admin.id, displayName: admin.displayName },
  reportDate: "2026-08-20",
  title: "削除テスト",
  summary: "",
  activityArea: "ロボット",
  contentCategory: "進捗",
  activityText: "作業した。",
  learningText: "",
  issueText: "",
  nextActionText: "",
  themeTags: [],
  status: "published",
  version: 1,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  relatedLinks: [],
  attachments: [],
};

function context(id = report.id) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/reports/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue(admin);
    mocks.getReadableReport.mockResolvedValue(report);
    mocks.deleteReportResources.mockResolvedValue(undefined);
    mocks.deleteReport.mockResolvedValue(undefined);
  });

  it("lets an Admin remove provider resources before deleting the report", async () => {
    const response = await DELETE(
      new Request(`https://hanabi.example/api/reports/${report.id}`, { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(204);
    expect(mocks.deleteReportResources).toHaveBeenCalledWith(report);
    expect(mocks.deleteReport).toHaveBeenCalledWith(report.id, admin);
    expect(mocks.deleteReportResources.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteReport.mock.invocationCallOrder[0],
    );
  });

  it("rejects members before reading or deleting the report", async () => {
    mocks.requireCurrentUser.mockResolvedValue({ ...admin, role: "member" });

    const response = await DELETE(
      new Request(`https://hanabi.example/api/reports/${report.id}`, { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(mocks.getReadableReport).not.toHaveBeenCalled();
    expect(mocks.deleteReportResources).not.toHaveBeenCalled();
    expect(mocks.deleteReport).not.toHaveBeenCalled();
  });

  it("keeps the database report when external cleanup fails", async () => {
    mocks.deleteReportResources.mockRejectedValue(new Error("Slack unavailable"));

    const response = await DELETE(
      new Request(`https://hanabi.example/api/reports/${report.id}`, { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(500);
    expect(mocks.deleteReport).not.toHaveBeenCalled();
  });
});
